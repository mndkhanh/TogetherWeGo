import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthProvidersResponse,
  type AuthResponse,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
} from '@twg/shared';
import type { Request, Response } from 'express';
import { Public } from '../common/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import {
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from './auth-cookies.js';
import { AccountExistsError, AuthService, type Session } from './auth.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { safeEqual } from '../common/safe-equal.js';

// Strict limits on credential endpoints to slow down password guessing.
const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Public()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleOAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @Throttle(CREDENTIAL_LIMIT)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.register(body, req.get('user-agent')));
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(CREDENTIAL_LIMIT)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.login(body, req.get('user-agent')));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    this.assertSameOrigin(req);
    const token = this.readRefreshCookie(req);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      return this.respond(res, await this.auth.refresh(token, req.get('user-agent')));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.config.cookieSecure));
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.assertSameOrigin(req);
    const token = this.readRefreshCookie(req);
    if (token) {
      await this.auth.logout(token);
    }
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.config.cookieSecure));
  }

  /** Which sign-in methods the web app should offer. */
  @Get('providers')
  providers(): AuthProvidersResponse {
    return { password: true, google: this.google.enabled };
  }

  @Get('google')
  async googleStart(@Res() res: Response): Promise<void> {
    const { url, state, codeVerifier } = await this.google.start();
    res.cookie(
      OAUTH_STATE_COOKIE,
      JSON.stringify({ state, codeVerifier }),
      oauthStateCookieOptions(this.config.cookieSecure),
    );
    res.redirect(url);
  }

  @Get('google/callback')
  @Throttle(CREDENTIAL_LIMIT)
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions(this.config.cookieSecure));
    const fail = (reason: string) =>
      res.redirect(`${this.config.appOrigin}/login?error=${encodeURIComponent(reason)}`);

    const saved = this.readOAuthState(req);
    // The state must match the cookie we set: this blocks login CSRF.
    if (!code || !state || !saved || !safeEqual(state, saved.state)) {
      fail('google_state');
      return;
    }

    try {
      const profile = await this.google.finish(code, saved.codeVerifier);
      const refresh = await this.auth.signInWithGoogle(profile, req.get('user-agent'));
      res.cookie(
        REFRESH_COOKIE,
        refresh.token,
        refreshCookieOptions(this.config.cookieSecure, refresh.expiresAt),
      );
      // The web app calls /auth/refresh on this page to get an access token.
      res.redirect(`${this.config.appOrigin}/auth/callback`);
    } catch (error) {
      if (error instanceof AccountExistsError) {
        fail('account_exists');
        return;
      }
      this.logger.warn({ err: error }, 'Google sign-in failed');
      fail('google_failed');
    }
  }

  private respond(res: Response, session: Session): AuthResponse {
    res.cookie(
      REFRESH_COOKIE,
      session.refresh.token,
      refreshCookieOptions(this.config.cookieSecure, session.refresh.expiresAt),
    );
    return session.response;
  }

  private readRefreshCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readOAuthState(req: Request): { state: string; codeVerifier: string } | undefined {
    const raw: unknown = req.cookies?.[OAUTH_STATE_COOKIE];
    if (typeof raw !== 'string') return undefined;
    try {
      const parsed = JSON.parse(raw) as { state?: unknown; codeVerifier?: unknown };
      return typeof parsed.state === 'string' && typeof parsed.codeVerifier === 'string'
        ? { state: parsed.state, codeVerifier: parsed.codeVerifier }
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Cookie-authenticated endpoints only accept requests from our own web app.
   * SameSite=Lax already blocks cross-site POSTs; this is defense in depth.
   */
  private assertSameOrigin(req: Request): void {
    if (req.get('origin') !== this.config.appOrigin) {
      throw new ForbiddenException('Invalid origin');
    }
  }
}

import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthResponse, Locale, LoginInput, RegisterInput } from '@twg/shared';
import { Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { toMeResponse } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { GoogleProfile } from './google-oauth.service.js';
import { PasswordService } from './password.service.js';
import { type IssuedRefreshToken, RefreshTokenService } from './refresh-token.service.js';

export interface Session {
  response: AuthResponse;
  refresh: IssuedRefreshToken;
}

/** Thrown when a Google sign-in matches an existing password account that isn't linked to Google. */
export class AccountExistsError extends Error {}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(input: RegisterInput, userAgent?: string): Promise<Session> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          ...(input.locale && { locale: input.locale }),
          ...(input.timeZone && { timeZone: input.timeZone }),
        },
      });
      return this.startSession(user, userAgent);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(input: LoginInput, userAgent?: string): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !valid) {
      // Same message for unknown email and wrong password: don't reveal which accounts exist.
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.startSession(user, userAgent);
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<Session> {
    const rotated = await this.refreshTokens.rotate(refreshToken, userAgent);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      response: await this.buildResponse(user),
      refresh: { token: rotated.token, expiresAt: rotated.expiresAt },
    };
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revoke(refreshToken);
  }

  /**
   * Finds or creates the user for a Google sign-in.
   * We deliberately do NOT auto-link Google to an existing password account with the same email:
   * emails aren't verified at registration yet, so someone could pre-register a victim's email
   * and then keep access after the victim signs in with Google.
   */
  async signInWithGoogle(
    profile: GoogleProfile,
    userAgent?: string,
    /** The language and time zone the web app was in, for a brand-new account. */
    prefs: { locale?: Locale; timeZone?: string } = {},
  ): Promise<IssuedRefreshToken> {
    let user = await this.prisma.user.findUnique({ where: { googleSub: profile.sub } });

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        throw new AccountExistsError();
      }
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          googleSub: profile.sub,
          avatarKey: profile.picture,
          ...(prefs.locale && { locale: prefs.locale }),
          ...(prefs.timeZone && { timeZone: prefs.timeZone }),
        },
      });
    }

    return this.refreshTokens.issue(user.id, userAgent);
  }

  private async startSession(user: User, userAgent?: string): Promise<Session> {
    return {
      response: await this.buildResponse(user),
      refresh: await this.refreshTokens.issue(user.id, userAgent),
    };
  }

  private async buildResponse(user: User): Promise<AuthResponse> {
    return {
      accessToken: await this.accessTokens.sign(user.id),
      expiresIn: this.accessTokens.ttlSeconds,
      user: toMeResponse(user),
    };
  }
}

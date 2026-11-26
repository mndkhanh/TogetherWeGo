import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleAuthStart {
  url: string;
  state: string;
  codeVerifier: string;
}

/** Google sign-in using the authorization code flow with PKCE and a state parameter. */
@Injectable()
export class GoogleOAuthService {
  private readonly client?: OAuth2Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.google) {
      this.client = new OAuth2Client({
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: config.google.redirectUri,
      });
    }
  }

  get enabled(): boolean {
    return this.client !== undefined;
  }

  async start(): Promise<GoogleAuthStart> {
    const client = this.requireClient();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(24).toString('base64url');
    const url = client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
    });
    return { url, state, codeVerifier };
  }

  /** Exchanges the code and verifies the ID token. Only verified Google emails are accepted. */
  async finish(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const client = this.requireClient();
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.id_token) {
      throw new Error('Google did not return an ID token');
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.google!.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new Error('Google account email is missing or not verified');
    }
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name ?? payload.email.split('@')[0]!,
      picture: payload.picture,
    };
  }

  private requireClient(): OAuth2Client {
    if (!this.client) {
      throw new NotFoundException('Google sign-in is not configured');
    }
    return this.client;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';

const ISSUER = 'togetherwego-api';
const AUDIENCE = 'togetherwego-web';

interface AccessTokenClaims {
  sub: string;
}

/** Short-lived (15 min by default) JWT access tokens, sent as `Authorization: Bearer`. */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get ttlSeconds(): number {
    return this.config.jwt.accessTtlSeconds;
  }

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({} satisfies Omit<AccessTokenClaims, 'sub'>, {
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
      expiresIn: this.config.jwt.accessTtlSeconds,
      secret: this.config.jwt.accessSecret,
    });
  }

  /** Returns the user id, or throws if the token is invalid or expired. */
  async verify(token: string): Promise<string> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      secret: this.config.jwt.accessSecret,
    });
    return claims.sub;
  }
}

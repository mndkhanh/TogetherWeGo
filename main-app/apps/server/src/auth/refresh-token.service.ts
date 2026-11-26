import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/**
 * A refresh token rotated within this window is treated as a benign race
 * (e.g. two browser tabs refreshing at once) rather than token theft.
 */
const REUSE_GRACE_MS = 30_000;

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Opaque refresh tokens, stored only as SHA-256 hashes.
 * Each use rotates the token. Presenting an already-rotated token revokes the
 * whole token family: either the user or an attacker holds a stolen copy.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(
    userId: string,
    userAgent?: string,
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(token),
        expiresAt,
        userAgent: userAgent?.slice(0, 255),
      },
    });
    return { token, expiresAt };
  }

  /** Exchanges a valid refresh token for a new one. Returns the user id and the new token. */
  async rotate(
    token: string,
    userAgent?: string,
  ): Promise<{ userId: string } & IssuedRefreshToken> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!existing) {
      throw new UnauthorizedException();
    }

    if (existing.revokedAt) {
      const withinGrace = Date.now() - existing.revokedAt.getTime() < REUSE_GRACE_MS;
      if (!withinGrace && existing.replacedBy) {
        this.logger.warn(
          { userId: existing.userId, familyId: existing.familyId },
          'Refresh token reuse detected, revoking token family',
        );
        await this.revokeFamily(existing.familyId);
      }
      throw new UnauthorizedException();
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }

    const next = await this.issue(existing.userId, userAgent, existing.familyId);
    const nextRow = await this.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(next.token) },
      select: { id: true },
    });

    // Conditional update: if a concurrent request already rotated this token, we lose the race.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedBy: nextRow.id },
    });
    if (count === 0) {
      await this.prisma.refreshToken.delete({ where: { id: nextRow.id } });
      throw new UnauthorizedException();
    }

    return { userId: existing.userId, ...next };
  }

  /** Revokes the token's whole family (logout from this device). Unknown tokens are ignored. */
  async revoke(token: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { familyId: true },
    });
    if (existing) {
      await this.revokeFamily(existing.familyId);
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

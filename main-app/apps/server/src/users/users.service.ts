import { Injectable, NotFoundException } from '@nestjs/common';
import { type MeResponse, toLocale, type UpdateMeInput } from '@twg/shared';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/** Avatars move to S3 in a later phase; until then only external (Google) URLs are stored. */
export function avatarUrlFor(avatarKey: string | null): string | null {
  return avatarKey?.startsWith('https://') ? avatarKey : null;
}

/** Maps a user row to the public API shape. Never exposes hashes or provider ids. */
export function toMeResponse(user: User): MeResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: avatarUrlFor(user.avatarKey),
    defaultCurrency: user.defaultCurrency,
    locale: toLocale(user.locale),
    timeZone: user.timeZone,
    hasPassword: user.passwordHash !== null,
    googleLinked: user.googleSub !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  update(id: string, input: UpdateMeInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: input });
  }
}

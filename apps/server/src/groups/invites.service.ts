import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateInviteInput,
  type InvitePreviewResponse,
  type InviteResponse,
  MAX_GROUP_MEMBERS,
} from '@twg/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { GroupAccessService } from './group-access.service.js';
import { toInviteResponse } from './group-mappers.js';

// No 0/O, 1/I/L: codes are sometimes read aloud or typed from a screenshot.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12; // 31^12 ≈ 2^59 possibilities: not guessable, even without rate limits.
export const INVITE_CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

const INVALID_INVITE = 'This invite link has expired or is no longer valid. Ask for a new one.';

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
  ) {}

  async create(groupId: string, userId: string, input: CreateInviteInput): Promise<InviteResponse> {
    await this.access.require(groupId, userId, { minRole: 'admin', requireActive: true });
    const invite = await this.prisma.groupInvite.create({
      data: {
        code: generateInviteCode(),
        groupId,
        createdBy: userId,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
        maxUses: input.maxUses,
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    return toInviteResponse(invite);
  }

  /** Invites that can still be used. */
  async listActive(groupId: string, userId: string): Promise<InviteResponse[]> {
    await this.access.require(groupId, userId, { minRole: 'admin' });
    const invites = await this.prisma.groupInvite.findMany({
      where: {
        groupId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        creator: {
          memberships: {
            some: { groupId, leftAt: null, role: { in: ['owner', 'admin'] } },
          },
        },
      },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return invites
      .filter((invite) => invite.maxUses === null || invite.uses < invite.maxUses)
      .map(toInviteResponse);
  }

  async revoke(groupId: string, userId: string, code: string): Promise<void> {
    await this.access.require(groupId, userId, { minRole: 'admin' });
    const { count } = await this.prisma.groupInvite.updateMany({
      where: { code, groupId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('Invite not found');
    }
  }

  async preview(code: string, userId: string): Promise<InvitePreviewResponse> {
    const invite = await this.prisma.groupInvite.findUnique({
      where: { code },
      include: {
        creator: {
          select: {
            name: true,
            // A link only works while its creator is still an admin or owner of the group.
            memberships: {
              where: { leftAt: null, role: { in: ['owner', 'admin'] } },
              select: { groupId: true },
            },
          },
        },
        group: { include: { members: { where: { leftAt: null }, select: { userId: true } } } },
      },
    });
    const creatorStillAdmin = invite?.creator.memberships.some((m) => m.groupId === invite.groupId);
    if (!invite || !isUsable(invite) || invite.group.archivedAt !== null || !creatorStillAdmin) {
      throw new NotFoundException(INVALID_INVITE);
    }
    return {
      groupId: invite.groupId,
      groupName: invite.group.name,
      memberCount: invite.group.members.length,
      invitedBy: invite.creator.name,
      alreadyMember: invite.group.members.some((m) => m.userId === userId),
    };
  }

  /**
   * Joins the group. Idempotent for people who are already members (no use is consumed).
   * The group row is locked so concurrent joins can't push the group past its size limit,
   * and the use counter is incremented with a guarded UPDATE so it can't exceed maxUses.
   */
  async accept(code: string, userId: string): Promise<{ groupId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.groupInvite.findUnique({ where: { code } });
      if (!invite) {
        throw new NotFoundException(INVALID_INVITE);
      }

      const [group] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM groups WHERE id = ${invite.groupId}::uuid FOR UPDATE`;
      if (!group || group.archived_at !== null) {
        throw new NotFoundException(INVALID_INVITE);
      }

      const existing = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: invite.groupId, userId } },
      });
      if (existing && existing.leftAt === null) {
        return { groupId: invite.groupId };
      }

      const memberCount = await tx.groupMember.count({
        where: { groupId: invite.groupId, leftAt: null },
      });
      if (memberCount >= MAX_GROUP_MEMBERS) {
        throw new ConflictException(`This group is full (${MAX_GROUP_MEMBERS} members)`);
      }

      const consumed = await tx.$executeRaw`
        UPDATE group_invites SET uses = uses + 1
        WHERE code = ${code}
          AND revoked_at IS NULL
          AND expires_at > now()
          AND (max_uses IS NULL OR uses < max_uses)
          -- Checked here rather than earlier so a creator leaving mid-request can't slip through.
          AND EXISTS (
            SELECT 1 FROM group_members m
            WHERE m.group_id = group_invites.group_id
              AND m.user_id = group_invites.created_by
              AND m.left_at IS NULL
              AND m.role IN ('owner', 'admin'))`;
      if (consumed === 0) {
        throw new NotFoundException(INVALID_INVITE);
      }

      // Rejoining restores the old membership row (as a regular member).
      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId } },
        create: { groupId: invite.groupId, userId, role: 'member' },
        update: { leftAt: null, role: 'member', joinedAt: new Date() },
      });
      return { groupId: invite.groupId };
    });
  }
}

function isUsable(invite: {
  revokedAt: Date | null;
  expiresAt: Date;
  maxUses: number | null;
  uses: number;
}): boolean {
  return (
    invite.revokedAt === null &&
    invite.expiresAt.getTime() > Date.now() &&
    (invite.maxUses === null || invite.uses < invite.maxUses)
  );
}

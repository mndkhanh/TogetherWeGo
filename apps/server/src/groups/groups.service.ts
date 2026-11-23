import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateGroupInput,
  type GroupDetailResponse,
  type GroupRole,
  type GroupSummaryResponse,
  roleAtLeast,
  type UpdateGroupInput,
} from '@twg/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { GroupAccessService } from './group-access.service.js';
import { toGroupDetail, toGroupSummary } from './group-mappers.js';

const activeMembersInclude = {
  members: {
    where: { leftAt: null },
    include: { user: { select: { id: true, name: true, avatarKey: true } } },
  },
} as const;

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
  ) {}

  /** Groups the user currently belongs to: active groups first, newest first. */
  async listForUser(userId: string): Promise<GroupSummaryResponse[]> {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId, leftAt: null },
      include: { group: { include: activeMembersInclude } },
    });
    return memberships
      .map((m) => toGroupSummary(m.group, m.role, m.group.members))
      .sort(
        (a, b) =>
          Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }

  async create(userId: string, input: CreateGroupInput): Promise<GroupDetailResponse> {
    const group = await this.prisma.group.create({
      data: {
        name: input.name,
        currency: input.currency,
        createdBy: userId,
        members: { create: { userId, role: 'owner' } },
      },
      include: activeMembersInclude,
    });
    return toGroupDetail(group, 'owner', group.members);
  }

  async get(groupId: string, userId: string): Promise<GroupDetailResponse> {
    const { membership } = await this.access.require(groupId, userId);
    return this.detail(groupId, membership.role);
  }

  async update(
    groupId: string,
    userId: string,
    input: UpdateGroupInput,
  ): Promise<GroupDetailResponse> {
    const { membership } = await this.access.require(groupId, userId, {
      minRole: 'admin',
      requireActive: true,
    });
    await this.prisma.group.update({ where: { id: groupId }, data: input });
    return this.detail(groupId, membership.role);
  }

  async setArchived(
    groupId: string,
    userId: string,
    archived: boolean,
  ): Promise<GroupDetailResponse> {
    const { membership } = await this.access.require(groupId, userId, { minRole: 'owner' });
    await this.prisma.group.update({
      where: { id: groupId },
      data: { archivedAt: archived ? new Date() : null },
    });
    return this.detail(groupId, membership.role);
  }

  /**
   * Removes a member, or lets a member leave (actor === target).
   * - The owner can't leave; they transfer ownership first.
   * - Admins can remove members; the owner can remove anyone else.
   */
  async removeMember(groupId: string, actorId: string, targetId: string): Promise<void> {
    const leaving = actorId === targetId;
    const { membership: actor } = await this.access.require(groupId, actorId, {
      minRole: leaving ? 'member' : 'admin',
      requireActive: !leaving,
    });

    if (leaving) {
      if (actor.role === 'owner') {
        throw new ConflictException('Make someone else the owner before you leave the group');
      }
    } else {
      const target = await this.requireActiveMember(groupId, targetId);
      if (!outranks(actor.role, target.role)) {
        throw new ForbiddenException('You can only remove members with a lower role than yours');
      }
    }

    // Phase 2 adds: refuse while the member still owes or is owed money in this group.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId: targetId } },
        data: { leftAt: now },
      }),
      // Links someone shared must stop working once they're no longer in the group.
      this.prisma.groupInvite.updateMany({
        where: { groupId, createdBy: targetId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  /**
   * Changes a member's role. Only the owner can do this.
   * Making someone the owner transfers ownership: the current owner becomes an admin.
   */
  async changeRole(
    groupId: string,
    actorId: string,
    targetId: string,
    role: GroupRole,
  ): Promise<GroupDetailResponse> {
    if (actorId === targetId) {
      throw new BadRequestException("You can't change your own role");
    }
    await this.access.require(groupId, actorId, { minRole: 'owner', requireActive: true });
    await this.requireActiveMember(groupId, targetId);

    if (role === 'owner') {
      // Demote first: the database allows only one active owner per group.
      await this.prisma.$transaction([
        this.prisma.groupMember.update({
          where: { groupId_userId: { groupId, userId: actorId } },
          data: { role: 'admin' },
        }),
        this.prisma.groupMember.update({
          where: { groupId_userId: { groupId, userId: targetId } },
          data: { role: 'owner' },
        }),
      ]);
      return this.detail(groupId, 'admin');
    }

    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetId } },
      data: { role },
    });
    return this.detail(groupId, 'owner');
  }

  private async requireActiveMember(groupId: string, userId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member || member.leftAt !== null) {
      throw new NotFoundException('That person is not a member of this group');
    }
    return member;
  }

  private async detail(groupId: string, myRole: GroupRole): Promise<GroupDetailResponse> {
    const group = await this.prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: activeMembersInclude,
    });
    return toGroupDetail(group, myRole, group.members);
  }
}

/** Strictly higher role: owners outrank admins, admins outrank members. */
function outranks(actor: GroupRole, target: GroupRole): boolean {
  return actor !== target && roleAtLeast(actor, target);
}

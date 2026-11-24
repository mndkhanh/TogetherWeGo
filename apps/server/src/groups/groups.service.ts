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
import { lockGroup, netBalances } from '../expenses/ledger.js';
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
    await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE: waits for in-flight expense writes (FOR SHARE) and blocks new ones, so
      // the first expense can't be saved in the old currency while it changes.
      const locked = await lockGroup(tx, groupId, 'update');
      if (input.currency && input.currency !== locked?.currency) {
        const hasExpenses = await tx.expense.count({ where: { groupId, deletedAt: null } });
        if (hasExpenses > 0) {
          throw new ConflictException(
            'You can’t change the currency after expenses have been added',
          );
        }
      }
      await tx.group.update({ where: { id: groupId }, data: input });
    });
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

    await this.prisma.$transaction(async (tx) => {
      // Lock the membership first: adding an expense for this person takes FOR SHARE on the
      // same row, so the balance can't change between this check and leaving.
      const [row] = await tx.$queryRaw<{ name: string }[]>`
        SELECT u.name FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = ${groupId}::uuid AND m.user_id = ${targetId}::uuid AND m.left_at IS NULL
        FOR UPDATE OF m`;
      if (!row) throw new NotFoundException('That person is not a member of this group');

      const net = (await netBalances(tx, groupId)).get(targetId) ?? 0;
      if (net !== 0) {
        throw new ConflictException(
          leaving
            ? 'You still owe or are owed money in this group. Settle up before you leave.'
            : `${row.name} still owes or is owed money in this group. Settle up before removing them.`,
        );
      }

      const now = new Date();
      await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: targetId } },
        data: { leftAt: now },
      });
      // Links someone shared must stop working once they're no longer in the group.
      await tx.groupInvite.updateMany({
        where: { groupId, createdBy: targetId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
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

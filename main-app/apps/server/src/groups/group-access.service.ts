import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type GroupRole, roleAtLeast } from '@twg/shared';
import type { Group, GroupMember } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export interface GroupAccess {
  group: Group;
  membership: GroupMember;
}

interface AccessOptions {
  /** Minimum role required. Defaults to any active member. */
  minRole?: GroupRole;
  /** Reject when the group is archived (for anything that changes the group). */
  requireActive?: boolean;
}

/**
 * The single place that decides who may see or change a group.
 * Non-members get 404, not 403, so group ids can't be probed for existence.
 */
@Injectable()
export class GroupAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(
    groupId: string,
    userId: string,
    { minRole = 'member', requireActive = false }: AccessOptions = {},
  ): Promise<GroupAccess> {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: { group: true },
    });
    if (!membership || membership.leftAt !== null) {
      throw new NotFoundException('Group not found');
    }
    if (!roleAtLeast(membership.role, minRole)) {
      throw new ForbiddenException(`Only a group ${minRole} can do this`);
    }
    if (requireActive && membership.group.archivedAt !== null) {
      throw new ConflictException('This group is archived. Unarchive it to make changes.');
    }
    const { group, ...rest } = membership;
    return { group, membership: rest };
  }
}

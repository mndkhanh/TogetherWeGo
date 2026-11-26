import type {
  GroupDetailResponse,
  GroupMemberResponse,
  GroupSummaryResponse,
  InviteResponse,
} from '@twg/shared';
import type { Group, GroupInvite, GroupMember, User } from '../generated/prisma/client.js';
import { avatarUrlFor } from '../users/users.service.js';

type MemberWithUser = GroupMember & { user: Pick<User, 'id' | 'name' | 'avatarKey'> };

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 } as const;

/** Owner first, then admins, then members; oldest members first within a role. */
export function sortMembers<T extends Pick<GroupMember, 'role' | 'joinedAt'>>(members: T[]): T[] {
  return [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.getTime() - b.joinedAt.getTime(),
  );
}

export function toMemberResponse(member: MemberWithUser): GroupMemberResponse {
  return {
    userId: member.userId,
    name: member.user.name,
    avatarUrl: avatarUrlFor(member.user.avatarKey),
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export function toGroupSummary(
  group: Group,
  myRole: GroupMember['role'],
  activeMembers: MemberWithUser[],
): GroupSummaryResponse {
  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    myRole,
    memberCount: activeMembers.length,
    memberPreview: sortMembers(activeMembers)
      .slice(0, 5)
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        avatarUrl: avatarUrlFor(m.user.avatarKey),
      })),
    archivedAt: group.archivedAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
  };
}

export function toGroupDetail(
  group: Group,
  myRole: GroupMember['role'],
  activeMembers: MemberWithUser[],
): GroupDetailResponse {
  const { memberPreview: _preview, ...summary } = toGroupSummary(group, myRole, activeMembers);
  return { ...summary, members: sortMembers(activeMembers).map(toMemberResponse) };
}

export function toInviteResponse(
  invite: GroupInvite & { creator: Pick<User, 'id' | 'name'> },
): InviteResponse {
  return {
    code: invite.code,
    expiresAt: invite.expiresAt.toISOString(),
    maxUses: invite.maxUses,
    uses: invite.uses,
    createdBy: { userId: invite.creator.id, name: invite.creator.name },
    createdAt: invite.createdAt.toISOString(),
  };
}

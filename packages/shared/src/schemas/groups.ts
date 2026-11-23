import { z } from 'zod';

export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** Highest role first. Owner > admin > member. */
const ROLE_RANK: Record<GroupRole, number> = { owner: 3, admin: 2, member: 1 };

export function roleAtLeast(role: GroupRole, minimum: GroupRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Largest group we support. Keeps balances and notification fan-out cheap. */
export const MAX_GROUP_MEMBERS = 50;

const currencySchema = z.enum(['VND', 'USD'], { error: 'Choose VND or USD' });

export const groupNameSchema = z
  .string({ error: 'Enter a group name' })
  .trim()
  .min(1, 'Enter a group name')
  .max(60, 'Use 60 characters or fewer');

export const createGroupSchema = z.object({
  name: groupNameSchema,
  currency: currencySchema,
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({ name: groupNameSchema, currency: currencySchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const INVITE_EXPIRY_DAYS = [1, 7, 30] as const;

export const createInviteSchema = z.object({
  expiresInDays: z
    .number({ error: 'Choose when the link expires' })
    .refine((days) => (INVITE_EXPIRY_DAYS as readonly number[]).includes(days), {
      message: 'Choose 1, 7 or 30 days',
    }),
  /** Null: anyone with the link can join until it expires. */
  maxUses: z.number().int().min(1, 'Allow at least 1 use').max(MAX_GROUP_MEMBERS).nullable(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(GROUP_ROLES, { error: 'Choose owner, admin or member' }),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

// ---------- Response shapes ----------

export interface GroupMemberResponse {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupSummaryResponse {
  id: string;
  name: string;
  currency: 'VND' | 'USD';
  myRole: GroupRole;
  memberCount: number;
  /** Up to 5 members, for avatar stacks. */
  memberPreview: Pick<GroupMemberResponse, 'userId' | 'name' | 'avatarUrl'>[];
  archivedAt: string | null;
  createdAt: string;
}

export interface GroupDetailResponse extends Omit<GroupSummaryResponse, 'memberPreview'> {
  members: GroupMemberResponse[];
}

export interface InviteResponse {
  code: string;
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  createdBy: { userId: string; name: string };
  createdAt: string;
}

/** What someone sees when they open an invite link, before joining. */
export interface InvitePreviewResponse {
  groupId: string;
  groupName: string;
  memberCount: number;
  invitedBy: string;
  alreadyMember: boolean;
}

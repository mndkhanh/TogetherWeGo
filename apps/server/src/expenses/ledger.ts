import type { Currency, GroupRole } from '@twg/shared';
import type { Prisma } from '../generated/prisma/client.js';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Net balance per person in a group, derived from expenses (never stored).
 * Positive: the group owes them. Negative: they owe. Every group sums to 0.
 * Phase 3 adds confirmed settlements to this query.
 */
export async function netBalances(db: Db, groupId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ user_id: string; net: bigint }[]>`
    SELECT user_id, SUM(delta)::bigint AS net
    FROM (
      SELECT payer_id AS user_id, amount AS delta
      FROM expenses
      WHERE group_id = ${groupId}::uuid AND deleted_at IS NULL
      UNION ALL
      SELECT s.user_id, -s.amount
      FROM expense_splits s
      JOIN expenses e ON e.id = s.expense_id
      WHERE e.group_id = ${groupId}::uuid AND e.deleted_at IS NULL
    ) AS ledger
    GROUP BY user_id`;
  return new Map(rows.map((row) => [row.user_id, Number(row.net)]));
}

/**
 * Locks the active memberships of these people for the rest of the transaction
 * (FOR SHARE), and returns each active member's role.
 *
 * Leaving and role changes write the same rows, so they wait for this transaction (and
 * vice versa): an expense can't be added for someone at the moment they leave, and an
 * admin who is being demoted can't slip an edit through with their old role.
 */
export async function lockActiveMembers(
  db: Db,
  groupId: string,
  userIds: string[],
): Promise<Map<string, GroupRole>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ user_id: string; role: GroupRole }[]>`
    SELECT user_id, role::text AS role FROM group_members
    WHERE group_id = ${groupId}::uuid
      AND user_id = ANY(${userIds}::uuid[])
      AND left_at IS NULL
    FOR SHARE`;
  return new Map(rows.map((row) => [row.user_id, row.role]));
}

/**
 * Locks the group row. Expense writes take FOR SHARE; changing the group's currency takes
 * FOR UPDATE, so the first expense and a currency change can't interleave.
 */
export async function lockGroup(
  db: Db,
  groupId: string,
  mode: 'share' | 'update',
): Promise<{ currency: Currency; archived: boolean } | null> {
  const rows =
    mode === 'share'
      ? await db.$queryRaw<{ currency: Currency; archived_at: Date | null }[]>`
          SELECT currency::text AS currency, archived_at FROM groups
          WHERE id = ${groupId}::uuid FOR SHARE`
      : await db.$queryRaw<{ currency: Currency; archived_at: Date | null }[]>`
          SELECT currency::text AS currency, archived_at FROM groups
          WHERE id = ${groupId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? { currency: row.currency, archived: row.archived_at !== null } : null;
}

import {
  type Currency,
  type ExpenseResponse,
  formatMoney,
  type GroupRole,
  type PersonRef,
  roleAtLeast,
  type SplitType,
} from '@twg/shared';
import type { Expense, ExpenseSplit, User } from '../generated/prisma/client.js';
import { avatarUrlFor } from '../users/users.service.js';

export const personSelect = { id: true, name: true, avatarKey: true } as const;
type PersonRow = Pick<User, 'id' | 'name' | 'avatarKey'>;

export const expenseInclude = {
  payer: { select: personSelect },
  creator: { select: personSelect },
  splits: { include: { user: { select: personSelect } } },
} as const;

export type ExpenseWithPeople = Expense & {
  payer: PersonRow;
  creator: PersonRow;
  splits: (ExpenseSplit & { user: PersonRow })[];
};

export function toPerson(user: PersonRow): PersonRef {
  return { userId: user.id, name: user.name, avatarUrl: avatarUrlFor(user.avatarKey) };
}

/** Postgres DATE <-> "YYYY-MM-DD". Dates are calendar days, so UTC midnight is used throughout. */
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
export function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Creator, payer, or a group admin/owner may change an expense. */
export function canEditExpense(
  expense: Pick<Expense, 'createdBy' | 'payerId'>,
  userId: string,
  role: GroupRole,
): boolean {
  return expense.createdBy === userId || expense.payerId === userId || roleAtLeast(role, 'admin');
}

export function toExpenseResponse(
  expense: ExpenseWithPeople,
  me: { userId: string; role: GroupRole },
): ExpenseResponse {
  const amount = Number(expense.amount);
  const myShare = Number(expense.splits.find((s) => s.userId === me.userId)?.amount ?? 0n);
  return {
    id: expense.id,
    groupId: expense.groupId,
    title: expense.title,
    amount,
    currency: expense.currency,
    payer: toPerson(expense.payer),
    splitType: expense.splitType,
    splits: [...expense.splits]
      .sort((a, b) => Number(b.amount - a.amount) || a.user.name.localeCompare(b.user.name))
      .map((s) => ({ ...toPerson(s.user), amount: Number(s.amount), value: s.value })),
    spentOn: fromDateOnly(expense.spentOn),
    note: expense.note,
    hasReceipt: expense.receiptKey !== null,
    createdBy: toPerson(expense.creator),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    version: expense.version,
    canEdit: canEditExpense(expense, me.userId, me.role),
    myNet: (expense.payerId === me.userId ? amount : 0) - myShare,
  };
}

// ---------- Audit snapshots ----------

/** What the activity log stores about an expense, before and after each change. */
export interface ExpenseSnapshot {
  title: string;
  amount: number;
  currency: Currency;
  payerId: string;
  splitType: SplitType;
  splits: { userId: string; amount: number; value: number }[];
  spentOn: string;
  note: string | null;
  receiptKey: string | null;
}

export function snapshotOf(expense: Expense & { splits: ExpenseSplit[] }): ExpenseSnapshot {
  return {
    title: expense.title,
    amount: Number(expense.amount),
    currency: expense.currency,
    payerId: expense.payerId,
    splitType: expense.splitType,
    splits: expense.splits
      .map((s) => ({ userId: s.userId, amount: Number(s.amount), value: s.value }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    spentOn: fromDateOnly(expense.spentOn),
    note: expense.note,
    receiptKey: expense.receiptKey,
  };
}

/** Readable lines describing what changed between two snapshots. */
export function describeChanges(
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
  nameOf: (userId: string) => string,
): string[] {
  const money = (amount: number) => formatMoney(amount, after.currency);
  const changes: string[] = [];
  if (before.title !== after.title) changes.push(`Title: “${before.title}” → “${after.title}”`);
  if (before.amount !== after.amount) {
    changes.push(`Amount: ${money(before.amount)} → ${money(after.amount)}`);
  }
  if (before.payerId !== after.payerId) {
    changes.push(`Paid by: ${nameOf(before.payerId)} → ${nameOf(after.payerId)}`);
  }
  if (before.spentOn !== after.spentOn) changes.push(`Date: ${before.spentOn} → ${after.spentOn}`);
  if (
    before.splitType !== after.splitType ||
    JSON.stringify(before.splits) !== JSON.stringify(after.splits)
  ) {
    const amounts = after.splits.map((s) => `${nameOf(s.userId)} ${money(s.amount)}`).join(', ');
    changes.push(`Split: ${amounts}`);
  }
  if (before.note !== after.note) changes.push(after.note ? 'Note edited' : 'Note removed');
  if (before.receiptKey !== after.receiptKey) {
    changes.push(
      after.receiptKey === null
        ? 'Receipt removed'
        : before.receiptKey
          ? 'Receipt replaced'
          : 'Receipt added',
    );
  }
  return changes;
}

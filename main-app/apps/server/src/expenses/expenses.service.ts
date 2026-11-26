import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type BalancesResponse,
  computeSplits,
  createExpenseSchema,
  type CreateExpenseInput,
  type Currency,
  type ExpenseDetailResponse,
  type ExpenseHistoryEntry,
  type ExpensePageResponse,
  type GroupRole,
  type ListExpensesQuery,
  type ReceiptUploadInput,
  type ReceiptUploadResponse,
  simplifyDebts,
  updateExpenseSchema,
} from '@twg/shared';
import { parseOrThrow } from '../common/zod-validation.pipe.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GroupAccessService } from '../groups/group-access.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import {
  canEditExpense,
  describeChanges,
  type ExpenseSnapshot,
  expenseInclude,
  type ExpenseWithPeople,
  personSelect,
  snapshotOf,
  toDateOnly,
  toExpenseResponse,
  toPerson,
} from './expense-mappers.js';
import { lockActiveMembers, lockGroup, netBalances } from './ledger.js';
import { ReceiptsService } from './receipts.service.js';

const NOT_FOUND = 'Expense not found';
const CONFLICT = 'Someone else changed this expense. Reload to see the latest version.';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly receipts: ReceiptsService,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    groupId: string,
    userId: string,
    query: ListExpensesQuery,
  ): Promise<ExpensePageResponse> {
    const { membership } = await this.access.require(groupId, userId);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.expense.findMany({
      where: {
        groupId,
        deletedAt: null,
        ...(query.eventId && { eventId: query.eventId }),
        ...(cursor && {
          OR: [
            { spentOn: { lt: cursor.spentOn } },
            { spentOn: cursor.spentOn, id: { lt: cursor.id } },
          ],
        }),
      },
      include: expenseInclude,
      orderBy: [{ spentOn: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((e) => toExpenseResponse(e, { userId, role: membership.role })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async get(expenseId: string, userId: string): Promise<ExpenseDetailResponse> {
    const { expense, membership } = await this.load(expenseId, userId);
    const [receiptUrl, history] = await Promise.all([
      expense.receiptKey ? this.receipts.viewUrl(expense.receiptKey) : null,
      this.history(expense.id),
    ]);
    return {
      ...toExpenseResponse(expense, { userId, role: membership.role }),
      receiptKey: expense.receiptKey,
      receiptUrl,
      history,
    };
  }

  async create(groupId: string, userId: string, body: unknown): Promise<ExpenseDetailResponse> {
    const { group } = await this.access.require(groupId, userId, { requireActive: true });
    const input = parseOrThrow(createExpenseSchema(group.currency), body);
    const splits = this.splitsFor(input);
    if (input.receiptKey) await this.receipts.assertAttachable(groupId, input.receiptKey);
    await this.assertEventInGroup(groupId, input.eventId);

    const expenseId = await this.prisma.$transaction(async (tx) => {
      await this.requireActive(tx, groupId, group.currency, [userId, ...peopleIn(input)]);
      const expense = await tx.expense.create({
        data: {
          groupId,
          payerId: input.payerId,
          amount: BigInt(input.amount),
          currency: group.currency,
          title: input.title,
          note: input.note,
          splitType: input.splitType,
          spentOn: toDateOnly(input.spentOn),
          receiptKey: input.receiptKey,
          eventId: input.eventId,
          createdBy: userId,
          splits: { create: splits },
        },
        include: { splits: true },
      });
      await this.log(tx, groupId, userId, 'expense.created', expense.id, {
        after: snapshotOf(expense),
      });
      await this.notify(tx, 'expense.added', userId, expense, [expense.payerId]);
      return expense.id;
    });
    this.outbox.kick();
    return this.get(expenseId, userId);
  }

  async update(expenseId: string, userId: string, body: unknown): Promise<ExpenseDetailResponse> {
    const { expense, membership } = await this.load(expenseId, userId);
    await this.access.require(expense.groupId, userId, { requireActive: true });
    this.assertCanEdit(expense, userId, membership.role);
    const input = parseOrThrow(updateExpenseSchema(expense.currency), body);
    const splits = this.splitsFor(input);
    if (input.receiptKey && input.receiptKey !== expense.receiptKey) {
      await this.receipts.assertAttachable(expense.groupId, input.receiptKey);
    }
    await this.assertEventInGroup(expense.groupId, input.eventId);

    await this.prisma.$transaction(async (tx) => {
      // Everyone affected, before and after, must still be in the group: people who left
      // have a zero balance, and changing this expense would silently change it.
      const roles = await this.requireActive(
        tx,
        expense.groupId,
        expense.currency,
        [userId, ...peopleIn(input)],
        expense,
      );
      this.assertCanEdit(expense, userId, roles.get(userId)!); // with the locked, current role

      const { count } = await tx.expense.updateMany({
        where: { id: expenseId, version: input.version, deletedAt: null },
        data: {
          payerId: input.payerId,
          amount: BigInt(input.amount),
          title: input.title,
          note: input.note,
          splitType: input.splitType,
          spentOn: toDateOnly(input.spentOn),
          receiptKey: input.receiptKey,
          eventId: input.eventId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw new ConflictException(CONFLICT);

      await tx.expenseSplit.deleteMany({ where: { expenseId } });
      await tx.expenseSplit.createMany({ data: splits.map((s) => ({ ...s, expenseId })) });

      const after = await tx.expense.findUniqueOrThrow({
        where: { id: expenseId },
        include: { splits: true },
      });
      await this.log(tx, expense.groupId, userId, 'expense.updated', expenseId, {
        before: snapshotOf(expense),
        after: snapshotOf(after),
      });
      // Everyone who was on it before or is on it now hears about the change.
      const before = [expense.payerId, ...expense.splits.map((s) => s.userId)];
      await this.notify(tx, 'expense.updated', userId, after, before);
    });
    this.outbox.kick();
    return this.get(expenseId, userId);
  }

  async remove(expenseId: string, userId: string): Promise<void> {
    const { expense, membership } = await this.load(expenseId, userId);
    await this.access.require(expense.groupId, userId, { requireActive: true });
    this.assertCanEdit(expense, userId, membership.role);

    await this.prisma.$transaction(async (tx) => {
      const roles = await this.requireActive(
        tx,
        expense.groupId,
        expense.currency,
        [userId],
        expense,
      );
      this.assertCanEdit(expense, userId, roles.get(userId)!); // with the locked, current role
      const { count } = await tx.expense.updateMany({
        where: { id: expenseId, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throw new NotFoundException(NOT_FOUND);
      await this.log(tx, expense.groupId, userId, 'expense.deleted', expenseId, {
        before: snapshotOf(expense),
      });
      await this.notify(tx, 'expense.deleted', userId, expense, []);
    });
    this.outbox.kick();
  }

  async balances(groupId: string, userId: string): Promise<BalancesResponse> {
    const { group } = await this.access.require(groupId, userId);
    const [nets, total, activeMembers] = await Promise.all([
      netBalances(this.prisma, groupId),
      this.prisma.expense.aggregate({
        where: { groupId, deletedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.groupMember.findMany({
        where: { groupId, leftAt: null },
        select: { userId: true },
      }),
    ]);

    const activeIds = new Set(activeMembers.map((m) => m.userId));
    const ids = new Set([
      ...activeIds,
      ...[...nets].filter(([, net]) => net !== 0).map(([id]) => id),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: personSelect,
    });

    const members = users
      .map((u) => ({ ...toPerson(u), net: nets.get(u.id) ?? 0, active: activeIds.has(u.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      currency: group.currency,
      totalSpent: Number(total._sum.amount ?? 0n),
      members,
      transfers: simplifyDebts(members.map((m) => ({ userId: m.userId, net: m.net }))),
    };
  }

  async createReceiptUpload(
    groupId: string,
    userId: string,
    input: ReceiptUploadInput,
  ): Promise<ReceiptUploadResponse> {
    await this.access.require(groupId, userId, { requireActive: true });
    return this.receipts.createUpload(groupId, input);
  }

  // ---------- helpers ----------

  /** Loads a live expense the user can see. Non-members get the same 404 as a missing id. */
  private async load(expenseId: string, userId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
      include: expenseInclude,
    });
    if (!expense) throw new NotFoundException(NOT_FOUND);
    try {
      const { membership } = await this.access.require(expense.groupId, userId);
      return { expense, membership };
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException(NOT_FOUND);
      throw error;
    }
  }

  private assertCanEdit(
    expense: ExpenseWithPeople,
    userId: string,
    role: Parameters<typeof canEditExpense>[2],
  ): void {
    if (!canEditExpense(expense, userId, role)) {
      throw new ForbiddenException(
        'Only the person who added it, the person who paid, or a group admin can change this expense',
      );
    }
  }

  /** A friendly 400 before the composite foreign key would reject it anyway. */
  private async assertEventInGroup(groupId: string, eventId: string | null): Promise<void> {
    if (!eventId) return;
    const event = await this.prisma.event.findFirst({ where: { id: eventId, groupId } });
    if (!event) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: [{ path: 'eventId', message: 'Choose an event in this group' }],
      });
    }
  }

  private splitsFor(input: CreateExpenseInput) {
    const result = computeSplits(input.amount, input.splitType, input.splits);
    if (!result.ok) throw new BadRequestException(result.error); // already checked by the schema
    const values = new Map(input.splits.map((s) => [s.userId, s.value]));
    return result.splits.map((s) => ({
      userId: s.userId,
      amount: BigInt(s.amount),
      value: input.splitType === 'equal' ? 1 : (values.get(s.userId) ?? 0),
    }));
  }

  /**
   * Inside the transaction: locks the group and everyone involved, then checks the group is
   * still open in the expected currency and that they are all active members. When `existing`
   * is given, the people already on that expense must still be members too.
   * Returns the locked roles, so permission checks use current data.
   */
  private async requireActive(
    tx: Prisma.TransactionClient,
    groupId: string,
    currency: Currency,
    userIds: string[],
    existing?: ExpenseWithPeople,
  ): Promise<Map<string, GroupRole>> {
    const group = await lockGroup(tx, groupId, 'share');
    if (!group) throw new NotFoundException('Group not found');
    if (group.archived) {
      throw new ConflictException('This group is archived. Unarchive it to make changes.');
    }
    if (group.currency !== currency) {
      throw new ConflictException('The group’s currency just changed. Reload and try again.');
    }

    const before = existing ? [existing.payer, ...existing.splits.map((s) => s.user)] : [];
    const all = [...new Set([...userIds, ...before.map((u) => u.id)])];
    const active = await lockActiveMembers(tx, groupId, all);

    const goneBefore = before.find((u) => !active.has(u.id));
    if (goneBefore) {
      throw new ConflictException(
        `${goneBefore.name} has left the group, so this expense can’t be changed`,
      );
    }
    if (userIds.some((id) => !active.has(id))) {
      throw new BadRequestException('Everyone on an expense must be a member of the group');
    }
    return active;
  }

  /** The people on an expense (payer and everyone sharing it), each told their own share. */
  private async notify(
    tx: Prisma.TransactionClient,
    type: 'expense.added' | 'expense.updated' | 'expense.deleted',
    actorId: string,
    expense: {
      id: string;
      groupId: string;
      title: string;
      amount: bigint;
      currency: Currency;
      payerId: string;
      splits: { userId: string; amount: bigint }[];
    },
    alsoTell: string[],
  ): Promise<void> {
    const involved = [expense.payerId, ...expense.splits.map((s) => s.userId), ...alsoTell];
    await this.outbox.add(tx, {
      type,
      groupId: expense.groupId,
      actorId,
      audience: { kind: 'users', userIds: [...new Set(involved)] },
      data: {
        groupId: expense.groupId,
        ...(await this.outbox.names(tx, expense.groupId, actorId)),
        expenseId: expense.id,
        title: expense.title,
        amount: Number(expense.amount),
        currency: expense.currency,
      },
      perUser:
        type === 'expense.deleted'
          ? undefined
          : Object.fromEntries(
              expense.splits.map((s) => [s.userId, { yourShare: Number(s.amount) }]),
            ),
    });
  }

  private async log(
    tx: Prisma.TransactionClient,
    groupId: string,
    actorId: string,
    action: string,
    entityId: string,
    diff: { before?: ExpenseSnapshot; after?: ExpenseSnapshot },
  ): Promise<void> {
    await tx.activityLog.create({
      data: { groupId, actorId, action, entity: 'expense', entityId, diff: diff as object },
    });
  }

  private async history(expenseId: string): Promise<ExpenseHistoryEntry[]> {
    const entries = await this.prisma.activityLog.findMany({
      where: { entity: 'expense', entityId: expenseId },
      include: { actor: { select: personSelect } },
      orderBy: { createdAt: 'asc' },
    });

    const diffs = entries.map(
      (e) => e.diff as { before?: ExpenseSnapshot; after?: ExpenseSnapshot },
    );
    const ids = new Set<string>();
    for (const diff of diffs) {
      for (const snap of [diff.before, diff.after]) {
        if (!snap) continue;
        ids.add(snap.payerId);
        for (const s of snap.splits) ids.add(s.userId);
      }
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    const nameOf = (id: string) => names.get(id) ?? 'Someone';

    return entries.map((entry, i) => {
      const diff = diffs[i]!;
      const action = entry.action.replace('expense.', '') as ExpenseHistoryEntry['action'];
      return {
        action,
        actor: toPerson(entry.actor),
        at: entry.createdAt.toISOString(),
        changes:
          action === 'updated' && diff.before && diff.after
            ? describeChanges(diff.before, diff.after, nameOf)
            : [],
      };
    });
  }
}

function peopleIn(input: CreateExpenseInput): string[] {
  return [input.payerId, ...input.splits.map((s) => s.userId)];
}

// Cursor = "<spentOn>_<id>", base64url-encoded. Opaque to clients.
function encodeCursor(expense: { spentOn: Date; id: string }): string {
  const day = expense.spentOn.toISOString().slice(0, 10);
  return Buffer.from(`${day}_${expense.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { spentOn: Date; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString();
  const match =
    /^(\d{4}-\d{2}-\d{2})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      text,
    );
  if (!match) throw new BadRequestException('Invalid cursor');
  return { spentOn: toDateOnly(match[1]!), id: match[2]! };
}

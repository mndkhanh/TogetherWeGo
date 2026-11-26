import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type BalancesResponse,
  createExpenseShape,
  type ExpenseDetailResponse,
  type ExpensePageResponse,
  type ListExpensesQuery,
  listExpensesQuerySchema,
  type ReceiptUploadInput,
  type ReceiptUploadResponse,
  receiptUploadSchema,
  updateExpenseShape,
} from '@twg/shared';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ExpensesService } from './expenses.service.js';

const GroupId = () => Param('groupId', new ParseUUIDPipe());
const ExpenseId = () => Param('expenseId', new ParseUUIDPipe());

/**
 * Bodies are checked for shape here; amount limits and split totals depend on the group's
 * currency, so the service validates those once it has loaded the group.
 */
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('groups/:groupId/expenses')
  list(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Query(new ZodValidationPipe(listExpensesQuerySchema)) query: ListExpensesQuery,
  ): Promise<ExpensePageResponse> {
    return this.expenses.list(groupId, user.id, query);
  }

  @Post('groups/:groupId/expenses')
  create(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Body(new ZodValidationPipe(createExpenseShape)) body: unknown,
  ): Promise<ExpenseDetailResponse> {
    return this.expenses.create(groupId, user.id, body);
  }

  @Get('groups/:groupId/balances')
  balances(@CurrentUser() user: AuthUser, @GroupId() groupId: string): Promise<BalancesResponse> {
    return this.expenses.balances(groupId, user.id);
  }

  @Post('groups/:groupId/receipts')
  receiptUpload(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Body(new ZodValidationPipe(receiptUploadSchema)) body: ReceiptUploadInput,
  ): Promise<ReceiptUploadResponse> {
    return this.expenses.createReceiptUpload(groupId, user.id, body);
  }

  @Get('expenses/:expenseId')
  get(
    @CurrentUser() user: AuthUser,
    @ExpenseId() expenseId: string,
  ): Promise<ExpenseDetailResponse> {
    return this.expenses.get(expenseId, user.id);
  }

  @Patch('expenses/:expenseId')
  update(
    @CurrentUser() user: AuthUser,
    @ExpenseId() expenseId: string,
    @Body(new ZodValidationPipe(updateExpenseShape)) body: unknown,
  ): Promise<ExpenseDetailResponse> {
    return this.expenses.update(expenseId, user.id, body);
  }

  @Delete('expenses/:expenseId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @ExpenseId() expenseId: string): Promise<void> {
    return this.expenses.remove(expenseId, user.id);
  }
}

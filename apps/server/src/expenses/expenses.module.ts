import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { ReceiptsService } from './receipts.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ReceiptsService],
})
export class ExpensesModule {}

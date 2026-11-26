import { Module } from '@nestjs/common';
import { GroupAccessService } from './group-access.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

@Module({
  controllers: [GroupsController, InvitesController],
  providers: [GroupAccessService, GroupsService, InvitesService],
  // Later phases (expenses, events, settlements) authorize through GroupAccessService.
  exports: [GroupAccessService],
})
export class GroupsModule {}

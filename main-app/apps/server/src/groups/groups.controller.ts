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
} from '@nestjs/common';
import {
  type CreateGroupInput,
  createGroupSchema,
  type CreateInviteInput,
  createInviteSchema,
  type GroupDetailResponse,
  type GroupSummaryResponse,
  type InviteResponse,
  type UpdateGroupInput,
  updateGroupSchema,
  type UpdateMemberRoleInput,
  updateMemberRoleSchema,
} from '@twg/shared';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GroupsService } from './groups.service.js';
import { InviteCodePipe } from './invite-code.pipe.js';
import { InvitesService } from './invites.service.js';

const GroupId = () => Param('groupId', new ParseUUIDPipe());
const UserId = () => Param('userId', new ParseUUIDPipe());

@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly invites: InvitesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<GroupSummaryResponse[]> {
    return this.groups.listForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ): Promise<GroupDetailResponse> {
    return this.groups.create(user.id, body);
  }

  @Get(':groupId')
  get(@CurrentUser() user: AuthUser, @GroupId() groupId: string): Promise<GroupDetailResponse> {
    return this.groups.get(groupId, user.id);
  }

  @Patch(':groupId')
  update(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupInput,
  ): Promise<GroupDetailResponse> {
    return this.groups.update(groupId, user.id, body);
  }

  @Post(':groupId/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @GroupId() groupId: string): Promise<GroupDetailResponse> {
    return this.groups.setArchived(groupId, user.id, true);
  }

  @Post(':groupId/unarchive')
  @HttpCode(200)
  unarchive(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
  ): Promise<GroupDetailResponse> {
    return this.groups.setArchived(groupId, user.id, false);
  }

  // ---------- Members ----------

  /** Remove a member, or leave the group when userId is your own id. */
  @Delete(':groupId/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @UserId() userId: string,
  ): Promise<void> {
    return this.groups.removeMember(groupId, user.id, userId);
  }

  @Patch(':groupId/members/:userId')
  changeRole(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @UserId() userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput,
  ): Promise<GroupDetailResponse> {
    return this.groups.changeRole(groupId, user.id, userId, body.role);
  }

  // ---------- Invites ----------

  @Get(':groupId/invites')
  listInvites(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
  ): Promise<InviteResponse[]> {
    return this.invites.listActive(groupId, user.id);
  }

  @Post(':groupId/invites')
  createInvite(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput,
  ): Promise<InviteResponse> {
    return this.invites.create(groupId, user.id, body);
  }

  @Delete(':groupId/invites/:code')
  @HttpCode(204)
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Param('code', InviteCodePipe) code: string,
  ): Promise<void> {
    return this.invites.revoke(groupId, user.id, code);
  }
}

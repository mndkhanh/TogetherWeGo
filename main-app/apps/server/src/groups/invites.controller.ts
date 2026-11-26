import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { InvitePreviewResponse } from '@twg/shared';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { InviteCodePipe } from './invite-code.pipe.js';
import { InvitesService } from './invites.service.js';

// Invite codes are unguessable, but limit lookups anyway to make scanning pointless.
const INVITE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/** Endpoints for the person who received the link. Requires sign-in. */
@Controller('invites')
@Throttle(INVITE_LIMIT)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get(':code')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('code', InviteCodePipe) code: string,
  ): Promise<InvitePreviewResponse> {
    return this.invites.preview(code, user.id);
  }

  @Post(':code/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('code', InviteCodePipe) code: string,
  ): Promise<{ groupId: string }> {
    return this.invites.accept(code, user.id);
  }
}

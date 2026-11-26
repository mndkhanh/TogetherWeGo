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
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type CommentPageResponse,
  type CommentResponse,
  type CreateCommentInput,
  createCommentSchema,
  createEventSchema,
  type EventDetailResponse,
  type EventPageResponse,
  type ListCommentsQuery,
  listCommentsQuerySchema,
  type ListEventsQuery,
  listEventsQuerySchema,
  type RsvpInput,
  rsvpSchema,
  updateEventSchema,
} from '@twg/shared';
import type { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { EventsService } from './events.service.js';

const GroupId = () => Param('groupId', new ParseUUIDPipe());
const EventId = () => Param('eventId', new ParseUUIDPipe());

/** Enough for a lively chat, not enough to flood a group. */
const COMMENT_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('groups/:groupId/events')
  list(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Query(new ZodValidationPipe(listEventsQuerySchema)) query: ListEventsQuery,
  ): Promise<EventPageResponse> {
    return this.events.list(groupId, user.id, query);
  }

  @Post('groups/:groupId/events')
  create(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Body(new ZodValidationPipe(createEventSchema)) body: z.output<typeof createEventSchema>,
  ): Promise<EventDetailResponse> {
    return this.events.create(groupId, user.id, body);
  }

  @Get('events/:eventId')
  get(@CurrentUser() user: AuthUser, @EventId() eventId: string): Promise<EventDetailResponse> {
    return this.events.get(eventId, user.id);
  }

  @Patch('events/:eventId')
  update(
    @CurrentUser() user: AuthUser,
    @EventId() eventId: string,
    @Body(new ZodValidationPipe(updateEventSchema)) body: z.output<typeof updateEventSchema>,
  ): Promise<EventDetailResponse> {
    return this.events.update(eventId, user.id, body);
  }

  @Post('events/:eventId/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @EventId() eventId: string): Promise<EventDetailResponse> {
    return this.events.cancel(eventId, user.id);
  }

  @Put('events/:eventId/rsvp')
  rsvp(
    @CurrentUser() user: AuthUser,
    @EventId() eventId: string,
    @Body(new ZodValidationPipe(rsvpSchema)) body: RsvpInput,
  ): Promise<EventDetailResponse> {
    return this.events.rsvp(eventId, user.id, body.status);
  }

  @Get('events/:eventId/comments')
  comments(
    @CurrentUser() user: AuthUser,
    @EventId() eventId: string,
    @Query(new ZodValidationPipe(listCommentsQuerySchema)) query: ListCommentsQuery,
  ): Promise<CommentPageResponse> {
    return this.events.comments(eventId, user.id, query);
  }

  @Post('events/:eventId/comments')
  @Throttle(COMMENT_LIMIT)
  addComment(
    @CurrentUser() user: AuthUser,
    @EventId() eventId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateCommentInput,
  ): Promise<CommentResponse> {
    return this.events.addComment(eventId, user.id, body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  deleteComment(
    @CurrentUser() user: AuthUser,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
  ): Promise<void> {
    return this.events.deleteComment(commentId, user.id);
  }
}

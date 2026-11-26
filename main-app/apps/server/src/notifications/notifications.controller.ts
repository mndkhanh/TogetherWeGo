import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
  type NotificationPageResponse,
  type NotificationPreferenceResponse,
  type NotificationPreferencesInput,
  notificationPreferencesSchema,
} from '@twg/shared';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<NotificationPageResponse> {
    return this.notifications.list(user.id, query);
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(200)
  read(
    @CurrentUser() user: AuthUser,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ): Promise<{ unreadCount: number }> {
    return this.notifications.markRead(user.id, notificationId);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser): Promise<{ unreadCount: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @Get('me/notification-preferences')
  preferences(@CurrentUser() user: AuthUser): Promise<NotificationPreferenceResponse[]> {
    return this.notifications.preferences(user.id);
  }

  @Put('me/notification-preferences')
  savePreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(notificationPreferencesSchema)) body: NotificationPreferencesInput,
  ): Promise<NotificationPreferenceResponse[]> {
    return this.notifications.savePreferences(user.id, body);
  }
}

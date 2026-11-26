import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The authenticated principal attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
}

export type AuthenticatedRequest = Request & { user: AuthUser };

/** Injects the authenticated user: `me(@CurrentUser() user: AuthUser)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

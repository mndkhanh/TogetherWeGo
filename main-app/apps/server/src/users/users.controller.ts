import { Body, Controller, Get, Patch } from '@nestjs/common';
import { type MeResponse, type UpdateMeInput, updateMeSchema } from '@twg/shared';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { toMeResponse, UsersService } from './users.service.js';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return toMeResponse(await this.users.getById(user.id));
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ): Promise<MeResponse> {
    return toMeResponse(await this.users.update(user.id, body));
  }
}

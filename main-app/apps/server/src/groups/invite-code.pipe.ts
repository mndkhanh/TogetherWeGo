import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { INVITE_CODE_PATTERN } from './invites.service.js';

/** Normalizes an invite code from the URL; malformed codes are treated as not found. */
@Injectable()
export class InviteCodePipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!INVITE_CODE_PATTERN.test(code)) {
      throw new NotFoundException(
        'This invite link has expired or is no longer valid. Ask for a new one.',
      );
    }
    return code;
  }
}

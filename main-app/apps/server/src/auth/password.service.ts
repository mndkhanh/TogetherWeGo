import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended parameters (19 MiB memory, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  /** Used to spend the same time on unknown emails, so login timing doesn't reveal which emails exist. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('dummy-password-for-timing', ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /** Verifies a password. Pass `null` as the hash for unknown users; it always returns false. */
  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const ok = await verify(passwordHash ?? this.dummyHash, password).catch(() => false);
    return passwordHash !== null && ok;
  }
}

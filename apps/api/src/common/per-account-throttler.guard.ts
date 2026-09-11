import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { emailSchema } from '@fp/contracts';

/**
 * Tracks by the normalised email in the request body rather than by source
 * IP — for routes whose abuse case is "many attempts against one account"
 * (login's FR-008 throttle, verification resend), as distinct from the
 * default per-source guard protecting the endpoint from a broad attack.
 */
@Injectable()
export class PerAccountThrottlerGuard extends ThrottlerGuard {
  // `req` is typed `Record<string, any>` by the base class we are overriding
  // (@nestjs/throttler ships no narrower type for an Express request body).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowed immediately below via a schema parse.
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const body: unknown = req.body;
    const rawEmail =
      typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string'
        ? body.email
        : '';
    const parsed = emailSchema.safeParse(rawEmail);
    return Promise.resolve(parsed.success ? `account:${parsed.data}` : 'account:unknown');
  }
}

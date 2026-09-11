import { err, ok, type DomainError, type Result, type UserId } from '@fp/kernel';

export interface EmailVerificationProps {
  id: string;
  userId: UserId;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  supersededAt: Date | null;
}

/**
 * A bearer credential, hashed for the same reason a session token is
 * (data-model.md): a database disclosure must not hand over a usable
 * verification link.
 */
export class EmailVerification {
  private constructor(private props: EmailVerificationProps) {}

  static issue(params: {
    id: string;
    userId: UserId;
    tokenHash: string;
    now: Date;
    ttlMs: number;
  }): EmailVerification {
    return new EmailVerification({
      id: params.id,
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: new Date(params.now.getTime() + params.ttlMs),
      consumedAt: null,
      supersededAt: null,
    });
  }

  static reconstitute(props: EmailVerificationProps): EmailVerification {
    return new EmailVerification(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  toProps(): Readonly<EmailVerificationProps> {
    return { ...this.props };
  }

  /** FR-003a: unknown, expired, consumed, or superseded are all `VerificationInvalid` — never distinguished. */
  private isUsable(now: Date): boolean {
    return (
      this.props.consumedAt === null &&
      this.props.supersededAt === null &&
      this.props.expiresAt > now
    );
  }

  consume(now: Date): Result<void, DomainError> {
    if (!this.isUsable(now)) {
      return err({ kind: 'VerificationInvalid' });
    }
    this.props = { ...this.props, consumedAt: now };
    return ok(undefined);
  }

  /** FR-003a: a resend invalidates the previously issued link, whether or not it was ever used. */
  supersede(now: Date): void {
    this.props = { ...this.props, supersededAt: now };
  }
}

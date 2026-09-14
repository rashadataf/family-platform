import type { MailerPort } from '@fp/kernel';

export interface SentMessage {
  to: string;
  subject: string;
  text: string;
}

/** Captures every message in memory instead of sending it, for integration tests to inspect. */
export class FakeMailer implements MailerPort {
  readonly sent: SentMessage[] = [];

  send(message: SentMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Pulls the raw token out of `registerUser`'s "Verification token: <token>" body (research.md §4). */
  latestVerificationToken(): string {
    return this.latestToken('Verification token');
  }

  /** The same extraction, for `createInvitation`'s "Invitation token: <token>" body (spec 008, research.md §8). */
  latestInvitationToken(): string {
    return this.latestToken('Invitation token');
  }

  private latestToken(label: string): string {
    const message = this.sent.at(-1);
    const match = new RegExp(`${label}: (\\S+)`).exec(message?.text ?? '');
    if (!match?.[1]) {
      throw new Error(`No ${label} found in the last sent message: ${JSON.stringify(message)}`);
    }
    return match[1];
  }
}

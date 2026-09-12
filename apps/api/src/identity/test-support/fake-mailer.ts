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
    const message = this.sent.at(-1);
    const match = /Verification token: (\S+)/.exec(message?.text ?? '');
    if (!match?.[1]) {
      throw new Error(
        `No verification token found in the last sent message: ${JSON.stringify(message)}`,
      );
    }
    return match[1];
  }
}

import { createTransport, type Transporter } from 'nodemailer';
import type { MailerPort } from '@fp/kernel';

/**
 * Stage 0 mail sink: Mailpit (research.md §4). No vendor, no credential — the
 * transport is plain unauthenticated SMTP, which is all a local sink needs.
 * Vendor selection for Stage 1 is deferred to its own ADR.
 */
const FROM_ADDRESS = 'no-reply@family-platform.invalid';

export interface SmtpMailerOptions {
  host: string;
  port: number;
}

/** Real SMTP transport, for composition-root wiring. Tests inject a fake transport instead. */
export function createSmtpTransport(options: SmtpMailerOptions): Transporter {
  return createTransport({ host: options.host, port: options.port, secure: false });
}

export class SmtpMailer implements MailerPort {
  constructor(private readonly transport: Transporter) {}

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    await this.transport.sendMail({
      from: FROM_ADDRESS,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

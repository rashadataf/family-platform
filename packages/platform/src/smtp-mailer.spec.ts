import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { SmtpMailer } from './smtp-mailer.js';

// `jsonTransport` is a real nodemailer transport that never touches the
// network — it serialises the message to JSON instead of sending it.
function fakeTransport() {
  return createTransport({ jsonTransport: true });
}

describe('SmtpMailer', () => {
  it('forwards recipient, subject, and body, and sets a from address', async () => {
    const transport = fakeTransport();
    const sendMailSpy = vi.spyOn(transport, 'sendMail');
    const mailer = new SmtpMailer(transport);

    await mailer.send({ to: 'ada@example.com', subject: 'Verify your email', text: 'Click here' });

    expect(sendMailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ada@example.com',
        subject: 'Verify your email',
        text: 'Click here',
      }),
    );
    const [sentMessage] = sendMailSpy.mock.calls[0] ?? [];
    expect(typeof sentMessage?.from).toBe('string');
  });

  it('resolves without throwing against the fake transport', async () => {
    const mailer = new SmtpMailer(fakeTransport());

    await expect(
      mailer.send({ to: 'ada@example.com', subject: 'Test', text: 'Body' }),
    ).resolves.toBeUndefined();
  });
});

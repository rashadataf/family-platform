/**
 * Generic infrastructure capability. See password-hasher.port.ts for why this
 * lives in the kernel rather than under a context's own `application/ports`.
 */
export interface MailerPort {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

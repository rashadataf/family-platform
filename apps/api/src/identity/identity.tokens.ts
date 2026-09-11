/**
 * DI tokens for the port interfaces `packages/core/identity`'s command and
 * query handlers depend on. NestJS needs a runtime token to inject an
 * interface by, since interfaces vanish at compile time.
 *
 * `OutboxPort` has no token of its own: an outbox repository is constructed
 * fresh inside `IDENTITY_UNIT_OF_WORK`'s own transaction, alongside every
 * other identity repository, not held as a process-lifetime singleton like
 * the adapters below.
 */
export const CLOCK = Symbol('CLOCK');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const TOKEN_GENERATOR = Symbol('TOKEN_GENERATOR');
export const MAILER = Symbol('MAILER');
export const IDENTITY_UNIT_OF_WORK = Symbol('IDENTITY_UNIT_OF_WORK');

import { PrismaClient } from './generated/prisma/index.js';

/**
 * The single instantiation point for PrismaClient in this codebase
 * (ADR-003, Constitution Principle IV). Never exported — packages/persistence
 * exposes narrow functions instead, never the client itself.
 *
 * Family scoping lives in `family-context.ts`, not here. The TODO that used to
 * sit at this spot proposed a Prisma client extension issuing
 * `SET LOCAL app.family_id` before every query; spec 008 built the mechanism
 * and the extension turned out to be the wrong shape for it — a hook wraps one
 * operation, while the setting is per transaction, so the extension would have
 * had to open a transaction per operation and silently break atomicity for any
 * command that writes twice. `withFamilyContext` puts both in the same scope
 * instead. ADR-017 records the change.
 */
export const prisma = new PrismaClient();

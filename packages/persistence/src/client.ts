import { PrismaClient } from '@prisma/client';

/**
 * The single instantiation point for PrismaClient in this codebase
 * (ADR-003, Constitution Principle IV). Never exported — packages/persistence
 * exposes narrow functions instead, never the client itself.
 *
 * TODO(ADR-003-rls): attach a client extension here that opens a transaction
 * and issues `SET LOCAL app.family_id` before any query, once the first
 * family-scoped table exists. Not built yet: there is no resolved
 * FamilyContext to source app.family_id from in this feature.
 */
export const prisma = new PrismaClient();

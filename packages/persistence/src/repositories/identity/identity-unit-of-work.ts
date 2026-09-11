import { identity } from '@fp/core';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { PrismaOutboxRepository } from '../outbox.repository.js';
import { PrismaDeviceRepository } from './device.repository.js';
import { PrismaEmailVerificationRepository } from './email-verification.repository.js';
import { PrismaSessionRepository } from './session.repository.js';
import { PrismaUserRepository } from './user.repository.js';

/**
 * Opens one Prisma interactive transaction per `run()` call and constructs
 * every repository against that SAME transaction client, so a command
 * handler writing through more than one of them gets atomicity for free
 * (ADR-005 Layer 2) without ever importing Prisma itself.
 */
export class PrismaIdentityUnitOfWork implements identity.IdentityUnitOfWorkPort {
  constructor(private readonly client: PrismaClient) {}

  async run<T>(work: (uow: identity.IdentityUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) =>
      work({
        users: new PrismaUserRepository(tx),
        emailVerifications: new PrismaEmailVerificationRepository(tx),
        sessions: new PrismaSessionRepository(tx),
        devices: new PrismaDeviceRepository(tx),
        outbox: new PrismaOutboxRepository(tx),
      }),
    );
  }
}

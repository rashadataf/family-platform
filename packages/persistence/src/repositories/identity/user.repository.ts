import { asUserId, type UserId } from '@fp/kernel';
import { identity } from '@fp/core';
import type { Prisma, PrismaClient, User as UserRow } from '../../generated/prisma/index.js';

function toDomain(row: UserRow): identity.User {
  return identity.User.reconstitute({
    id: asUserId(row.id),
    email: identity.EmailAddress.from(row.email),
    passwordHash: row.passwordHash,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    deletionRequestedAt: row.deletionRequestedAt,
    failedAttemptCount: row.failedAttemptCount,
    throttledUntil: row.throttledUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaUserRepository implements identity.UserRepository {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async findByEmailAcrossAllStatuses(email: string): Promise<identity.User | null> {
    const row = await this.client.user.findUnique({ where: { email } });
    return row ? toDomain(row) : null;
  }

  async findById(id: UserId): Promise<identity.User | null> {
    const row = await this.client.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async save(user: identity.User): Promise<void> {
    const props = user.toProps();
    const data = {
      email: props.email.value,
      passwordHash: props.passwordHash,
      status: props.status,
      emailVerifiedAt: props.emailVerifiedAt,
      deletionRequestedAt: props.deletionRequestedAt,
      failedAttemptCount: props.failedAttemptCount,
      throttledUntil: props.throttledUntil,
    };

    await this.client.user.upsert({
      where: { id: props.id },
      // createdAt is set only on create — Prisma's own @default(now()) would
      // otherwise silently override the aggregate's actual registration time
      // with "whenever this row happened to be first written," which is the
      // wrong value for anything keyed on it (FR-020's retention sweep).
      create: { id: props.id, createdAt: props.createdAt, ...data },
      update: data,
    });
  }
}

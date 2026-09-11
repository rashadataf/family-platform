import { asUserId, type UserId } from '@fp/kernel';
import { identity } from '@fp/core';
import type {
  EmailVerification as EmailVerificationRow,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/index.js';

function toDomain(row: EmailVerificationRow): identity.EmailVerification {
  return identity.EmailVerification.reconstitute({
    id: row.id,
    userId: asUserId(row.userId),
    tokenHash: Buffer.from(row.tokenHash).toString('hex'),
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    supersededAt: row.supersededAt,
  });
}

export class PrismaEmailVerificationRepository implements identity.EmailVerificationRepository {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async findByTokenHash(tokenHash: string): Promise<identity.EmailVerification | null> {
    const row = await this.client.emailVerification.findUnique({
      where: { tokenHash: Buffer.from(tokenHash, 'hex') },
    });
    return row ? toDomain(row) : null;
  }

  async findActiveByUserId(userId: UserId): Promise<identity.EmailVerification | null> {
    const row = await this.client.emailVerification.findFirst({
      where: { userId, consumedAt: null, supersededAt: null },
      orderBy: { expiresAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async save(verification: identity.EmailVerification): Promise<void> {
    const props = verification.toProps();
    const data = {
      userId: props.userId,
      tokenHash: Buffer.from(props.tokenHash, 'hex'),
      expiresAt: props.expiresAt,
      consumedAt: props.consumedAt,
      supersededAt: props.supersededAt,
    };

    await this.client.emailVerification.upsert({
      where: { id: props.id },
      create: { id: props.id, ...data },
      update: data,
    });
  }
}

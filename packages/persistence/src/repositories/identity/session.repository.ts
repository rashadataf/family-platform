import { asDeviceId, asSessionId, asUserId, type SessionId, type UserId } from '@fp/kernel';
import { identity } from '@fp/core';
import type {
  Prisma,
  PrismaClient,
  Session as SessionRow,
  SessionRevokedReason as PrismaSessionRevokedReason,
} from '../../generated/prisma/index.js';

function toDomain(row: SessionRow): identity.Session {
  return identity.Session.reconstitute({
    id: asSessionId(row.id),
    userId: asUserId(row.userId),
    deviceId: asDeviceId(row.deviceId),
    tokenHash: Buffer.from(row.tokenHash).toString('hex'),
    previousTokenHash: row.previousTokenHash
      ? Buffer.from(row.previousTokenHash).toString('hex')
      : null,
    issuedAt: row.issuedAt,
    rotatedAt: row.rotatedAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
  });
}

export class PrismaSessionRepository implements identity.SessionRepository {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async findById(id: SessionId): Promise<identity.Session | null> {
    const row = await this.client.session.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<identity.Session | null> {
    const row = await this.client.session.findUnique({
      where: { tokenHash: Buffer.from(tokenHash, 'hex') },
    });
    return row ? toDomain(row) : null;
  }

  async findAuthContextByTokenHash(tokenHash: string): Promise<identity.SessionAuthContext | null> {
    const row = await this.client.session.findUnique({
      where: { tokenHash: Buffer.from(tokenHash, 'hex') },
      include: { user: { select: { status: true } } },
    });
    return row ? { session: toDomain(row), userStatus: row.user.status } : null;
  }

  async findByCurrentOrPreviousTokenHash(tokenHash: string): Promise<identity.SessionMatch | null> {
    const hash = Buffer.from(tokenHash, 'hex');
    const row = await this.client.session.findFirst({
      where: { OR: [{ tokenHash: hash }, { previousTokenHash: hash }] },
    });
    if (!row) {
      return null;
    }
    const matchedPrevious = !Buffer.from(row.tokenHash).equals(hash);
    return { session: toDomain(row), matchedPrevious };
  }

  async listSummariesByUserId(userId: UserId): Promise<identity.SessionSummary[]> {
    const rows = await this.client.session.findMany({
      where: { userId },
      include: { device: { select: { label: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((row) => ({
      sessionId: asSessionId(row.id),
      deviceLabel: row.device.label,
      issuedAt: row.issuedAt,
      rotatedAt: row.rotatedAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
    }));
  }

  async listByUserId(userId: UserId): Promise<identity.Session[]> {
    const rows = await this.client.session.findMany({ where: { userId } });
    return rows.map(toDomain);
  }

  async listExportSummariesByUserId(userId: UserId): Promise<identity.ExportedSessionSummary[]> {
    const rows = await this.client.session.findMany({
      where: { userId },
      include: { device: { select: { label: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((row) => ({
      deviceLabel: row.device.label,
      issuedAt: row.issuedAt,
      revokedAt: row.revokedAt,
    }));
  }

  async save(session: identity.Session): Promise<void> {
    const props = session.toProps();
    const data = {
      userId: props.userId,
      deviceId: props.deviceId,
      tokenHash: Buffer.from(props.tokenHash, 'hex'),
      previousTokenHash: props.previousTokenHash
        ? Buffer.from(props.previousTokenHash, 'hex')
        : null,
      rotatedAt: props.rotatedAt,
      absoluteExpiresAt: props.absoluteExpiresAt,
      revokedAt: props.revokedAt,
      revokedReason: props.revokedReason satisfies PrismaSessionRevokedReason | null,
    };

    await this.client.session.upsert({
      where: { id: props.id },
      create: { id: props.id, issuedAt: props.issuedAt, ...data },
      update: data,
    });
  }
}

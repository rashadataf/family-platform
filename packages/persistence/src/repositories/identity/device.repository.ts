import { asDeviceId, asUserId, type DeviceId } from '@fp/kernel';
import { identity } from '@fp/core';
import type { Device as DeviceRow, Prisma, PrismaClient } from '../../generated/prisma/index.js';

function toDomain(row: DeviceRow): identity.Device {
  return identity.Device.reconstitute({
    id: asDeviceId(row.id),
    userId: asUserId(row.userId),
    label: row.label,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  });
}

export class PrismaDeviceRepository implements identity.DeviceRepository {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async findById(id: DeviceId): Promise<identity.Device | null> {
    const row = await this.client.device.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async save(device: identity.Device): Promise<void> {
    const props = device.toProps();
    const data = {
      userId: props.userId,
      label: props.label,
      lastSeenAt: props.lastSeenAt,
    };

    await this.client.device.upsert({
      where: { id: props.id },
      create: { id: props.id, firstSeenAt: props.firstSeenAt, ...data },
      update: data,
    });
  }
}

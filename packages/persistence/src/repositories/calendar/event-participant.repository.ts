import { calendar } from '@fp/core';
import {
  asFamilyMemberId,
  type CalendarEventId,
  type FamilyId,
  type FamilyMemberId,
} from '@fp/kernel';
import { Prisma } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';

/** PostgreSQL's foreign_key_violation, as Prisma reports it for a model call. */
const FOREIGN_KEY_VIOLATION = 'P2003';

export class PrismaEventParticipantRepository implements calendar.EventParticipantRepository {
  constructor(
    private readonly tx: TransactionClient,
    private readonly familyId: FamilyId,
  ) {}

  async replaceForEvent(
    eventId: CalendarEventId,
    memberIds: readonly FamilyMemberId[],
  ): Promise<void> {
    await this.tx.eventParticipant.deleteMany({
      where: { eventId, memberId: { notIn: [...memberIds] } },
    });
    if (memberIds.length === 0) return;

    try {
      // The composite foreign key onto `family_member (id, family_id)` is the
      // check (FR-018). Foreign-key checks are not subject to row-level
      // security, so this is the database answering "is this a member of THIS
      // family" — not Calendar reading a Family table to find out (FR-027).
      await this.tx.eventParticipant.createMany({
        data: memberIds.map((memberId) => ({ eventId, familyId: this.familyId, memberId })),
        skipDuplicates: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new calendar.ParticipantNotInFamilyError();
      }
      throw error;
    }
  }

  async listForEvent(eventId: CalendarEventId): Promise<readonly calendar.EventParticipant[]> {
    const rows = await this.tx.eventParticipant.findMany({
      where: { eventId },
      orderBy: [{ addedAt: 'asc' }, { memberId: 'asc' }],
    });
    return rows.map((row) => ({ memberId: asFamilyMemberId(row.memberId), addedAt: row.addedAt }));
  }
}

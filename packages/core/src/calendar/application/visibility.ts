import type { CalendarEventId, FamilyId, FamilyMemberId, UserId } from '@fp/kernel';
import type { AuditLogPort } from '../../compliance/application/ports/audit-log.port.js';
import type {
  MemberVisibility,
  MemberVisibilityPort,
} from '../../family/application/ports/member-visibility.port.js';

/**
 * FR-016 and FR-017, shared by every Calendar read and every Calendar write
 * that addresses an existing event. One implementation, so a later route
 * cannot apply a slightly different rule.
 */

export interface Reader {
  readonly familyId: FamilyId;
  readonly memberId: FamilyMemberId;
  readonly userId: UserId | null;
  readonly correlationId: string;
}

export interface ResolvedVisibility {
  readonly visible: ReadonlySet<FamilyMemberId>;
  readonly guardedChildren: ReadonlySet<FamilyMemberId>;
  readonly visibleMemberIds: readonly FamilyMemberId[];
}

/**
 * Asked in its own transaction, before Calendar opens one: the port's adapter
 * cannot join a transaction it was not given, and this codebase's ports do not
 * take transactions (research.md §1, "Cost, stated honestly").
 */
export async function resolveVisibility(
  port: MemberVisibilityPort,
  reader: Reader,
): Promise<ResolvedVisibility> {
  const result: MemberVisibility = await port.resolveVisibleMemberIds(
    reader.memberId,
    reader.familyId,
  );
  return {
    visible: new Set(result.visibleMemberIds),
    guardedChildren: new Set(result.guardedChildIds),
    visibleMemberIds: result.visibleMemberIds,
  };
}

/**
 * The participants that put an event out of this reader's reach. An event is
 * hidden if ANY participant is outside the visible set — showing it would
 * disclose the unguarded child's commitment, whatever else is on it
 * (contracts/calendar-api.md). No participants at all: visible to every reader.
 */
export function hiddenParticipants(
  participants: readonly FamilyMemberId[],
  visibility: ResolvedVisibility,
): FamilyMemberId[] {
  return participants.filter((member) => !visibility.visible.has(member));
}

/** The participants a permitted read reaches that are children — the rows FR-017 audits. */
export function guardedChildParticipants(
  participants: readonly FamilyMemberId[],
  visibility: ResolvedVisibility,
): FamilyMemberId[] {
  return participants.filter((member) => visibility.guardedChildren.has(member));
}

/**
 * One audit row per (event, child), at event-read granularity — never per
 * occurrence, which would write a row per fortnightly lesson per screen render
 * and drown the signal (contracts/calendar-api.md). The subject is the CHILD,
 * as spec 008's own child-record audit makes it; the event is named in
 * `purpose` by identifier only.
 */
export async function auditChildParticipation(
  audit: AuditLogPort,
  params: {
    reader: Reader;
    eventId: CalendarEventId;
    childMemberIds: readonly FamilyMemberId[];
    view: 'event detail' | 'calendar range' | 'event change';
    result: 'granted' | 'denied';
  },
): Promise<void> {
  for (const childMemberId of params.childMemberIds) {
    await audit.append({
      actorUserId: params.reader.userId,
      actorMemberId: params.reader.memberId,
      familyId: params.reader.familyId,
      subjectType: 'family_member',
      subjectId: childMemberId,
      action: 'calendar_participation.read',
      purpose: `${params.view} of calendar event ${params.eventId}`,
      result: params.result,
      // The real reason, which the caller is not told: on the wire a hidden
      // event is indistinguishable from a missing one (FR-016, SC-011).
      reason:
        params.result === 'granted'
          ? null
          : 'event has a child participant the reader holds no active guardianship for (FR-016)',
      correlationId: params.reader.correlationId,
    });
  }
}

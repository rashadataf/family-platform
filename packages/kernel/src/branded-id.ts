/**
 * Nominal typing for identifiers. Without the brand, `UserId` and `SessionId`
 * are both `string` and TypeScript cannot stop one being passed where the
 * other belongs (Principle I) — the exact mistake that matters most in a
 * context whose entire job is knowing who is who.
 */
declare const brand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, 'UserId'>;
export type SessionId = Branded<string, 'SessionId'>;
export type DeviceId = Branded<string, 'DeviceId'>;

export function asUserId(value: string): UserId {
  return value as UserId;
}

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

export function asDeviceId(value: string): DeviceId {
  return value as DeviceId;
}

/**
 * Family and Membership (spec 008). `FamilyId` is the tenant key: it is the
 * value bound to `app.family_id` for a transaction (ADR-017) and the value
 * every family-scoped table carries. Branding it is what stops a
 * `FamilyMemberId` being passed where the scope is expected — the one
 * substitution in this system that would silently widen a query's blast
 * radius rather than narrow it.
 */
export type FamilyId = Branded<string, 'FamilyId'>;
export type FamilyMemberId = Branded<string, 'FamilyMemberId'>;
export type InvitationId = Branded<string, 'InvitationId'>;
export type GuardianshipId = Branded<string, 'GuardianshipId'>;

export function asFamilyId(value: string): FamilyId {
  return value as FamilyId;
}

export function asFamilyMemberId(value: string): FamilyMemberId {
  return value as FamilyMemberId;
}

export function asInvitationId(value: string): InvitationId {
  return value as InvitationId;
}

export function asGuardianshipId(value: string): GuardianshipId {
  return value as GuardianshipId;
}

/**
 * Calendar (spec 009). Branded separately so that an occurrence id passed
 * where an event id is expected is a compile error — the cancel-one-occurrence
 * route takes both in the same path, which is exactly where the two would
 * otherwise be swapped silently.
 */
export type CalendarEventId = Branded<string, 'CalendarEventId'>;
export type EventOccurrenceId = Branded<string, 'EventOccurrenceId'>;

export function asCalendarEventId(value: string): CalendarEventId {
  return value as CalendarEventId;
}

export function asEventOccurrenceId(value: string): EventOccurrenceId {
  return value as EventOccurrenceId;
}

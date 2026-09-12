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

import type { OutboxEventToAppend, SessionId, UserId } from '@fp/kernel';

/**
 * ADR-005's event catalogue convention: past tense, context-prefixed,
 * explicitly versioned. All three of this context's events are integration
 * events (ADR-005 Layer 2) — nothing in this context needs a same-context
 * Layer 1 domain event, so these are the only event shapes it defines.
 *
 * Payloads carry identifiers only, never personal data (ARCHITECTURE.md
 * §7.3, Principle VIII) — a consumer that needs more calls a read port, once
 * one exists.
 */
export const IDENTITY_EVENT_TYPES = {
  UserRegistered: 'identity.UserRegistered.v1',
  UserAuthenticated: 'identity.UserAuthenticated.v1',
  UserDeletionRequested: 'identity.UserDeletionRequested.v1',
} as const;

export function userRegisteredEvent(params: {
  userId: UserId;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: IDENTITY_EVENT_TYPES.UserRegistered,
    aggregateType: 'User',
    aggregateId: params.userId,
    payload: { userId: params.userId },
    correlationId: params.correlationId,
  };
}

export function userAuthenticatedEvent(params: {
  userId: UserId;
  sessionId: SessionId;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: IDENTITY_EVENT_TYPES.UserAuthenticated,
    aggregateType: 'User',
    aggregateId: params.userId,
    payload: { userId: params.userId, sessionId: params.sessionId },
    correlationId: params.correlationId,
  };
}

export function userDeletionRequestedEvent(params: {
  userId: UserId;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: IDENTITY_EVENT_TYPES.UserDeletionRequested,
    aggregateType: 'User',
    aggregateId: params.userId,
    payload: { userId: params.userId },
    correlationId: params.correlationId,
  };
}

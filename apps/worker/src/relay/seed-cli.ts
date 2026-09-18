import { randomUUID } from 'node:crypto';
import type { JsonValue } from '@fp/kernel';
import { createOutboxAppender, disconnectDatabase } from '@fp/persistence';

/**
 * `relay:seed` (quickstart.md, integration suite). Writes one `outbox_event`
 * row directly through `OutboxPort`, bypassing every producing context —
 * the only place in the codebase that does (`createOutboxAppender`'s own
 * doc comment in `packages/persistence`).
 *
 * Usage: `pnpm --filter worker relay:seed --event-type <type> --payload '<json>'`
 */
function parseArgs(argv: readonly string[]): {
  eventType: string;
  payload: Record<string, JsonValue>;
} {
  const eventTypeIndex = argv.indexOf('--event-type');
  const eventType = eventTypeIndex === -1 ? undefined : argv[eventTypeIndex + 1];
  if (eventType === undefined || eventType === '') {
    throw new Error('relay:seed requires --event-type <event-type>.');
  }

  const payloadIndex = argv.indexOf('--payload');
  const rawPayload = payloadIndex === -1 ? undefined : argv[payloadIndex + 1];
  if (rawPayload === undefined) {
    throw new Error('relay:seed requires --payload <json>.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new Error(`relay:seed: --payload is not valid JSON: ${rawPayload}`);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('relay:seed: --payload must be a JSON object.');
  }

  return { eventType, payload: payload as Record<string, JsonValue> };
}

async function main(): Promise<void> {
  const { eventType, payload } = parseArgs(process.argv.slice(2));
  const outbox = createOutboxAppender();

  await outbox.append({
    eventType,
    aggregateType: 'RelaySeed',
    aggregateId: randomUUID(),
    payload,
    correlationId: randomUUID(),
  });

  console.log(`Seeded outbox_event: eventType=${eventType} payload=${JSON.stringify(payload)}`);
  await disconnectDatabase();
}

await main();

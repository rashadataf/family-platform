import { createSqsClient, peekQueueMessages } from '@fp/platform';
import { parseWorkerEnv } from '../config/worker-env.js';

/**
 * `relay:peek` (quickstart.md): prints, without removing, whatever is
 * currently on a named queue — built on `SqsMessagePublisher`'s own client
 * constructor (`createSqsClient`), so this tool and the relay itself always
 * point at the same endpoint.
 *
 * Usage: `pnpm --filter worker relay:peek <queue-name>`
 */
async function main(): Promise<void> {
  const [queueName] = process.argv.slice(2);
  if (queueName === undefined || queueName === '') {
    throw new Error(
      'relay:peek requires a queue name argument, e.g. `relay:peek outbox-relay-verification`.',
    );
  }

  const env = parseWorkerEnv();
  const client = createSqsClient({
    endpoint: env.relayQueueEndpoint,
    region: env.relayQueueRegion,
  });
  const bodies = await peekQueueMessages(client, queueName);

  if (bodies.length === 0) {
    console.log(`(no messages on ${queueName})`);
    return;
  }

  for (const body of bodies) {
    console.log(body);
  }
}

await main();

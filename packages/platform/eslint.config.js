// @ts-check
import fpConfig from '@fp/config-eslint';
import { allowQueueClients } from '@fp/config-eslint/queue-access.js';

export default [
  ...fpConfig,
  // This package IS the SQS adapter (ADR-018, spec 011 FR-010): these two
  // modules are the single place the AWS SDK is imported, which is what lets
  // the rule forbid it everywhere else.
  ...allowQueueClients(['src/sqs-message-publisher.ts', 'src/sqs-consumer.ts']),
  {
    ignores: ['dist/**'],
  },
];

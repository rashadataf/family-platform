// @ts-check
import fpConfig from '@fp/config-eslint';
import { allowQueueClients } from '@fp/config-eslint/queue-access.js';

export default [
  ...fpConfig,
  // The relay is the one caller allowed to hold a queue client (ADR-005
  // Layer 3, spec 011 FR-010). Its integration specs are included on purpose:
  // they drive a real queue through the production client, which is the only
  // way to test a transport adapter at all.
  ...allowQueueClients(['src/relay/**']),
  {
    ignores: ['dist/**'],
  },
];

// @ts-check

/**
 * Principle VIII's named enforcement: a bounded context reaches the queue by
 * writing to the outbox, never by constructing a queue client of its own
 * (spec 011 FR-010, ADR-005 Layer 3).
 *
 * Two doors, both shut:
 *
 * 1. The AWS SDK itself. `packages/platform` owns the single SQS adapter, so
 *    the dependency lives in exactly one package and a second one cannot
 *    appear by `pnpm add` and an import.
 * 2. `@fp/platform`'s SQS *exports*. The barrel also carries `SystemClock` and
 *    the mailer, which everything may import — so this restricts the client
 *    constructors by name rather than blocking the package. The types
 *    (`ConsumerHandler`, `ConsumerOutcome`) stay importable: a handler
 *    signature is not a client, and `test-support/stub-consumer.ts` is built
 *    on it without ever opening a connection.
 *
 * Like `boundaries.js`, this layer exists for LATENCY — it marks the import in
 * the editor as it is typed. `.dependency-cruiser.cjs`'s `no-direct-sqs-access`
 * stays authoritative, because `// eslint-disable-next-line` can silence this
 * one and cannot silence the gate (FR-007). If the two disagree, the gate wins.
 *
 * Patterns carry the `**` prefix for the reason `boundaries.js` gives: ESLint
 * runs per package under Turborepo but from the repository root in most
 * editors, and a pattern anchored at one alone would silently match nothing in
 * the other — an inert rule that reports success is worse than no rule.
 */

/** The SDK package. Only the one adapter module may touch it. */
const SDK_MODULES = ['@aws-sdk/client-sqs', 'aws-sdk'];

/** `@fp/platform`'s queue clients, by export name. Types are deliberately absent. */
const QUEUE_CLIENT_EXPORTS = [
  'SqsMessagePublisher',
  'SqsConsumer',
  'createSqsClient',
  'peekQueueMessages',
];

const SDK_MESSAGE =
  'The AWS SDK belongs to packages/platform/src/sqs-*.ts only (spec 011 FR-010, ADR-018). Depend on MessagePublisherPort from @fp/kernel instead.';

const CLIENT_MESSAGE =
  'Queue clients are the relay\'s (apps/worker/src/relay/). A bounded context reaches the queue by writing an outbox_event row in its own transaction — never by publishing or consuming directly (Principle VIII, ADR-005 Layer 3, spec 011 FR-010).';

/**
 * The exception, spread by the two packages whose stated job is to own the
 * transport rather than to be a context that bypassed it:
 * `packages/platform`'s adapter, and `apps/worker`'s relay.
 *
 * Declared per package, not centrally, because a flat-config `files` glob
 * resolves against the directory of the config that carries it — and ESLint
 * runs with each package as its own working directory under Turborepo. A
 * central `**​/packages/platform/src/sqs-*.ts` matches nothing in that run, and
 * an exception that silently fails to apply turns the rule below into noise on
 * legitimate code. The package's own config is the one place the path is
 * unambiguous.
 *
 * @param {string[]} files - globs relative to the calling package's root.
 * @returns {import('eslint').Linter.Config[]}
 */
export function allowQueueClients(files) {
  return [{ files, rules: { 'no-restricted-imports': 'off' } }];
}

export default [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...SDK_MODULES.map((name) => ({ name, message: SDK_MESSAGE })),
            {
              name: '@fp/platform',
              importNames: QUEUE_CLIENT_EXPORTS,
              message: CLIENT_MESSAGE,
            },
          ],
          patterns: [
            {
              group: ['**/platform/src/sqs-*', '@fp/platform/**/sqs-*'],
              message: CLIENT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
];

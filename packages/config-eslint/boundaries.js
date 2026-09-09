// @ts-check
import boundaries from 'eslint-plugin-boundaries';

/**
 * Import zones mirroring `.dependency-cruiser.cjs` (ARCHITECTURE.md §6, §8.2
 * layer 2).
 *
 * This layer exists for LATENCY, not coverage. It marks a forbidden import in
 * the editor as it is typed, where the boundary gate reports after a push.
 * `dependency-cruiser` stays authoritative for two reasons: a per-file linter
 * structurally cannot see a cycle spanning several packages, and a lint rule
 * can be silenced with `// eslint-disable-next-line` whereas the gate cannot
 * be silenced at all (FR-007). If the two ever disagree, the gate is right.
 *
 * Patterns are prefixed with `**` deliberately. ESLint runs per package under
 * Turborepo (`eslint .` with the package as the working directory) but from
 * the repository root in most editors, so a pattern anchored at either one
 * alone would silently match nothing in the other — an inert rule that
 * reports success is worse than no rule.
 */

// Order matters: the first matching descriptor classifies the file, so the
// most specific patterns come first.
const elements = [
  {
    type: 'ports',
    pattern: '**/core/*/application/ports/**',
    partialMatch: false,
    capture: ['context'],
  },
  {
    type: 'application',
    pattern: '**/core/*/application/**',
    partialMatch: false,
    capture: ['context'],
  },
  { type: 'domain', pattern: '**/core/*/domain/**', partialMatch: false, capture: ['context'] },
  { type: 'app', pattern: '**/apps/*/**', partialMatch: false, capture: ['app'] },
  { type: 'kernel', pattern: '**/packages/kernel/**', partialMatch: false },
  { type: 'persistence', pattern: '**/packages/persistence/**', partialMatch: false },
  { type: 'platform', pattern: '**/packages/platform/**', partialMatch: false },
  { type: 'contracts', pattern: '**/packages/contracts/**', partialMatch: false },
  { type: 'ai', pattern: '**/packages/ai/**', partialMatch: false },
];

/** Packages whose whole point is to be framework and infrastructure aware. */
const INFRASTRUCTURE_MODULES = [
  '@nestjs/*',
  '@prisma/*',
  'prisma',
  '@aws-sdk/*',
  'aws-sdk',
  'express',
  'axios',
];

const policies = [
  // A cross-context import of anything but a published port. Contexts talk
  // through `application/ports/**` (ARCHITECTURE §7.1) or the outbox (§7.3).
  {
    from: { element: { types: { anyOf: ['domain', 'application'] } } },
    disallow: {
      to: {
        element: {
          types: { anyOf: ['domain', 'application'] },
          captures: { context: '!{{from.context}}' },
        },
      },
    },
  },

  // domain/ may import its own context and @fp/kernel. Nothing else — no
  // framework, no ORM, no cloud SDK, no HTTP client (ARCHITECTURE §6). This is
  // what lets domain tests run in under a second with no database.
  {
    from: { element: { type: 'domain' } },
    disallow: { to: { module: { origin: 'external' } } },
  },
  {
    from: { element: { type: 'domain' } },
    allow: { to: { module: { origin: 'external', source: ['@fp/kernel'] } } },
  },

  // The application layer declares ports; persistence and platform implement
  // them. A handler importing Prisma or NestJS directly cannot be tested
  // without them and cannot be extracted later.
  {
    from: { element: { types: { anyOf: ['domain', 'application'] } } },
    disallow: {
      to: { element: { types: { anyOf: ['persistence', 'platform', 'contracts', 'ai'] } } },
    },
  },
  {
    from: { element: { types: { anyOf: ['domain', 'application'] } } },
    disallow: { to: { module: { origin: 'external', source: INFRASTRUCTURE_MODULES } } },
  },

  // Infrastructure adapters must not know about a bounded context, and the
  // wire contract must not drag domain code across the API boundary.
  {
    from: { element: { types: { anyOf: ['platform', 'contracts'] } } },
    disallow: {
      to: { element: { types: { anyOf: ['domain', 'application', 'persistence'] } } },
    },
  },

  // Principle VII: the AI package must be removable. Only a composition root
  // wires it in, through a port.
  {
    from: { element: { type: '!ai' } },
    disallow: { to: { element: { type: 'ai' } } },
  },
];

export default [
  {
    plugins: { boundaries },
    settings: {
      // Without a resolver the plugin cannot map `./thing.js` to `thing.ts`,
      // classifies every dependency as unknown, and then every policy below
      // matches nothing while still reporting success. An inert rule that
      // reports success is the exact failure this feature exists to remove.
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': elements,
      // Files outside every element above — root configs, scripts, tests —
      // are not part of the layered graph and are left to the gate.
      'boundaries/ignore': ['**/*.config.{js,ts}', '**/*.spec.{js,ts}', '**/*.test.{js,ts}'],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          // `default: 'allow'` deliberately. Fail-closed is
          // `.dependency-cruiser.cjs`'s job, and duplicating it in a layer that
          // `// eslint-disable-next-line` can silence would misrepresent how
          // strong this one is. Every rule below is therefore an explicit
          // prohibition.
          default: 'allow',
          // Without this, dependencies on npm packages and Node built-ins are
          // not examined at all and every `origin: 'external'` policy below is
          // inert while still reporting success. It defaults to false.
          checkAllOrigins: true,
          policies,
        },
      ],
    },
  },
];

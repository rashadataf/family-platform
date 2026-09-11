/** @type {import('dependency-cruiser').IConfiguration} */

// The allowed-edge graph for this repository (Constitution Principle III,
// ARCHITECTURE.md §6 and §8.2). This is the authoritative boundary gate:
// `eslint-plugin-boundaries` reports the same violations in the editor, but
// only this can see a cycle that spans several files across several packages.
//
// FR-007: dependency-cruiser has no per-line suppression mechanism, and that
// is why it is the authority rather than a lint rule. Changing an
// architectural boundary is an edit to this file — a reviewable diff — never
// a comment silencing one import.

// ---------------------------------------------------------------------------
// The one edit that admits a package to the graph (FR-008).
//
// Every workspace package must appear here. A package that does not is a
// violation of the `allowed` set below, because `allowed` is default-deny:
// an edge matching no entry fails (FR-006). That is deliberate and is the
// property most of these rules depend on — the majority govern packages that
// ARCHITECTURE.md §8 describes but that do not exist yet, so they have to be
// in force *before* the package arrives rather than written afterwards.
//
// Each key may import: itself, `packages/config-*` (its own lint and
// TypeScript configuration), and whatever its array lists. The layer rules in
// ARCHITECTURE.md §6 are the source for those arrays.
// ---------------------------------------------------------------------------
const WORKSPACE_GRAPH = {
  // Composition roots. "apps/* may import everything except other apps"
  // (ARCHITECTURE §6) — the exception is enforced by `no-cross-app` below.
  'apps/api': ['packages'],
  'apps/worker': ['packages'],

  // Pure, dependency-free primitives every context and every layer may use
  // (ARCHITECTURE §6). Depends on nothing but npm packages and Node built-ins,
  // which the blanket rules above already allow.
  'packages/kernel': [],

  // Every bounded context lives here. `domain-is-pure` and
  // `no-cross-context-internals` below do the fine-grained enforcement within
  // this package; at the workspace-edge level it may only reach the kernel.
  'packages/core': ['packages/kernel'],

  // The wire boundary (ADR-006). Standalone by design — see
  // `contracts-are-standalone` below.
  'packages/contracts': [],

  // Infrastructure adapters. May reach the kernel only —
  // `platform-has-no-domain` below forbids it reaching a bounded context.
  'packages/platform': ['packages/kernel'],

  // Infrastructure. May reach core and the kernel; must not reach contracts,
  // ai, or any app.
  'packages/persistence': ['packages/core', 'packages/kernel'],

  // The integration-test harness. It drives a real database through the same
  // package everything else does, and exports no client of its own.
  'packages/testing': ['packages/persistence'],

  // Shared configuration. Leaves: they depend on npm packages only.
  'packages/config-eslint': [],
  'packages/config-prettier': [],
  'packages/config-typescript': [],

  // The vps-staging Pulumi stack (spec 003, ADR-004/ADR-013). Deploy
  // tooling, not application code — it never imports packages/persistence's
  // client or any application package, only its own config schema and npm's
  // Pulumi providers.
  infrastructure: [],
};

/**
 * `apps/api` is permitted `packages` wholesale above; every other entry names
 * specific targets. Expanding here rather than in the table keeps the table
 * readable.
 */
const workspaceAllowed = Object.entries(WORKSPACE_GRAPH).flatMap(([pkg, mayImport]) =>
  [pkg, 'packages/config-', ...mayImport].map((target) => ({
    from: { path: `^${pkg}/` },
    to: { path: `^${target}` },
  })),
);

module.exports = {
  // -------------------------------------------------------------------------
  // Default deny. An edge matching none of these is reported as
  // `not-in-allowed` at `allowedSeverity` (FR-006).
  //
  // A `forbidden`-only configuration would fail OPEN: it enumerates what is
  // banned, so anything unmentioned passes. Since most of the structure this
  // repository is heading towards does not exist yet, fail-open would leave
  // the entire rule set decorative until `packages/core` lands.
  // -------------------------------------------------------------------------
  allowed: [
    // Node built-ins. Restricted again for `domain/` by `domain-is-pure`.
    { from: {}, to: { dependencyTypes: ['core'] } },

    // Third-party packages declared in the importing package's own
    // package.json. This is intentionally broad: which npm packages a
    // workspace package may use is governed by ARCHITECTURE §8.2's strongest
    // layer — dependency absence under pnpm's strict, non-hoisted layout,
    // where an undeclared import is a resolution failure rather than a lint
    // warning. The rules below then restrict specific ones per layer.
    {
      from: {},
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'npm-bundled'] },
    },

    // The workspace graph.
    ...workspaceAllowed,

    // Repository tooling: `scripts/**` and the root config files. Not part of
    // the runtime graph — this is the code that orchestrates a developer's
    // environment and checks the repository itself.
    { from: { path: '^scripts/' }, to: { path: '^scripts/' } },
    { from: { path: '^[^/]+\\.(c|m)?(j|t)s$' }, to: { path: '^packages/config-' } },

    // Test files may use the integration harness. Production modules may not —
    // `harness-is-test-only` below says so by name.
    { from: { path: '\\.(spec|test)\\.ts$' }, to: { path: '^packages/testing/' } },

    // `scripts/` reads the API's environment schema so that `pnpm verify:env`
    // and `pnpm dev` validate against the one authoritative definition rather
    // than a second copy that drifts (Principle II).
    { from: { path: '^scripts/' }, to: { path: '^apps/api/src/config/' } },
  ],
  allowedSeverity: 'error',

  // -------------------------------------------------------------------------
  // Named rules. `not-in-allowed` already fails an unlisted edge; these exist
  // because a violation message naming the architectural rule that was broken
  // is worth far more to whoever hits it than "this edge is not allowed"
  // (FR-003).
  // -------------------------------------------------------------------------
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A dependency cycle. Whichever module you think is the lower-level one, the graph disagrees. Extract the shared part, or invert the dependency with an interface owned by the importer.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'An import that does not resolve. Under pnpm strict linking this usually means the package is not declared in this package.json — which is ARCHITECTURE §8.2 layer 4 doing its job, not a tooling glitch.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'persistence-client-is-private',
      severity: 'error',
      comment:
        'The Prisma client is private to packages/persistence (ADR-003, Principle IV). It is instantiated exactly once, in client.ts, and never exported: the package exposes narrow functions instead. Importing it elsewhere bypasses the family-scoping extension that will be attached there.',
      from: { pathNot: '^packages/persistence/' },
      to: {
        path: 'node_modules/(\\.pnpm/)?@prisma[+/]client|^packages/persistence/src/(client|generated)',
      },
    },
    {
      name: 'no-cross-app',
      severity: 'error',
      comment:
        'One app importing another (ARCHITECTURE §6). Apps are composition roots and deployment units; shared code belongs in a package.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },

    {
      name: 'harness-is-test-only',
      severity: 'error',
      comment:
        'packages/testing is the integration-test harness. Only a *.spec.ts / *.test.ts file may import it. A production module reaching for a test fixture means the fixture is really domain code and belongs somewhere else.',
      from: { pathNot: '\\.(spec|test)\\.ts$|^packages/testing/|^vitest\\.config\\.ts$' },
      to: { path: '^packages/testing/' },
    },

    // ---- Rules for the structure that does not exist yet -------------------
    // Written now because `allowed` fails closed: these must be in force
    // before the package arrives, not retrofitted once it has (FR-005).
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'packages/core/<context>/domain may import @fp/kernel and nothing else (ARCHITECTURE §6). No framework, no ORM, no cloud SDK, no HTTP client, no clock, no randomness. This is what lets domain tests run in under a second with no database and no container.',
      from: { path: '^packages/core/[^/]+/domain/' },
      to: {
        path: [
          'node_modules/(\\.pnpm/)?(@nestjs|@prisma|prisma|express|fastify|axios|node-fetch|undici|got|@aws-sdk|aws-sdk|@google-cloud|ioredis|bullmq|pg|mongoose)',
          '^(crypto|timers|node:crypto|node:timers)$',
        ].join('|'),
      },
    },
    {
      name: 'no-cross-context-internals',
      severity: 'error',
      comment:
        "A context reached into another context's internals. Cross-context reads go through a published port under application/ports (ARCHITECTURE §7.1); anything that is not a pure read goes through the outbox (§7.3). If you need another context's data shape, that context publishes a DTO in its port signature.",
      from: { path: '^packages/core/([^/]+)/' },
      to: {
        path: '^packages/core/[^/]+/',
        pathNot: '^(packages/core/$1/|packages/core/[^/]+/application/ports/)',
      },
    },
    {
      name: 'application-layer-has-no-infrastructure',
      severity: 'error',
      comment:
        'The application layer declares ports; packages/persistence and packages/platform implement them (ARCHITECTURE §6, dependency inversion). An application handler that imports Prisma or NestJS directly cannot be tested without them and cannot be extracted later.',
      from: { path: '^packages/core/[^/]+/application/' },
      to: {
        path: '^packages/(persistence|platform|contracts|ai)/|node_modules/(\\.pnpm/)?(@nestjs|@prisma|prisma|@aws-sdk|aws-sdk)',
      },
    },
    {
      name: 'contracts-are-standalone',
      severity: 'error',
      comment:
        'packages/contracts is the wire boundary and is consumed by the mobile app as well as the API. It must not drag domain or infrastructure code across that boundary.',
      from: { path: '^packages/contracts/' },
      to: { path: '^packages/(core|persistence|platform|ai)/|^apps/' },
    },
    {
      name: 'platform-has-no-domain',
      severity: 'error',
      comment:
        'packages/platform holds infrastructure adapters and may import @fp/kernel only (ARCHITECTURE §6). An adapter that knows about a bounded context is no longer an adapter.',
      from: { path: '^packages/platform/' },
      to: { path: '^packages/(core|persistence)/' },
    },
    {
      name: 'nothing-depends-on-ai',
      severity: 'error',
      comment:
        'Principle VII: AI proposes, the domain decides. Nothing outside packages/ai may import it — the AI module must be removable, and ARCHITECTURE §8.2 requires that to be verifiable by building without it. apps/* wires it in at the composition root through a port.',
      from: { pathNot: '^packages/ai/|^apps/' },
      to: { path: '^packages/ai/' },
    },
  ],

  options: {
    // node_modules is a leaf: its contents are somebody else's graph.
    doNotFollow: { path: 'node_modules' },

    // Build output, coverage and the generated Prisma client are not source.
    // Excluding `dist` is what makes the resolution below necessary.
    exclude: {
      path: '(^|/)(dist|\\.turbo|coverage|node_modules)(/|$)|/src/generated/',
    },

    // Workspace packages resolve to SOURCE, not to `dist`.
    //
    // Without this, `@fp/persistence` resolves through its package.json `main`
    // to packages/persistence/dist/index.js — which the exclusion above then
    // removes, deleting the apps/api -> persistence edge from the graph
    // entirely. The most important workspace edge in the repository would be
    // invisible to its boundary checker, and every cross-package rule here
    // would be unreachable.
    //
    // Resolving through dist instead would make the gate depend on build
    // state: on a clean checkout, or in the `boundaries` CI job which does not
    // build first, there would be no dist and so no cross-package edges. A
    // check that silently weakens depending on whether someone ran a build is
    // worse than no check.
    //
    // This tsconfig exists only for this cruise. It changes no build.
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,

    // Resolve packages that publish only an `exports` map with no `main`
    // (typescript-eslint, among others), which the defaults miss.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.d.ts', '.json'],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

# ADR-001: Monorepo tooling

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer
- **Supersedes:** none

## Context

The blueprint calls for a monorepo containing an Expo mobile app, a NestJS API, a worker, several shared TypeScript packages, and Pulumi infrastructure code. The initial team is one developer. The candidates named were pnpm, Turborepo and Nx.

Two things are actually being decided and they are frequently conflated:

1. **The package manager and workspace linker.** How dependencies resolve and what a package can import.
2. **The task orchestrator.** How builds, tests and lints run, and what gets cached.

They have different answers and different stakes. The package manager choice turns out to matter more to this architecture than the task runner choice, for a reason specific to how [ARCHITECTURE.md](../ARCHITECTURE.md) enforces module boundaries.

## Decision

**pnpm workspaces for dependency management, Turborepo for task orchestration.**

Module boundaries are enforced by `eslint-plugin-boundaries` and `dependency-cruiser` in CI, replacing the capability that Nx would have provided natively.

The mobile app uses pnpm with `node-linker=hoisted` scoped to `apps/mobile` if Metro or an Expo config plugin misbehaves with symlinks, and this fallback is documented in the repository rather than discovered under pressure.

## Alternatives considered

### Nx

Nx is a stronger tool than Turborepo on the axes it competes on. It is rejected here, but not because it is worse in general.

**What Nx would genuinely give us:**

- `@nx/enforce-module-boundaries` with tag-based rules. This is real. The architecture in this repository depends heavily on boundary enforcement, and Nx's implementation is more expressive than an ESLint zone config.
- A project graph that understands the whole workspace, powering affected-only task execution with more precision than Turborepo's hashing.
- Generators, which reduce the friction of creating the next bounded context correctly.
- Better distributed caching and task distribution at large scale.

**Why it is still rejected:**

**It is a framework, not a tool, and it wants to own the build.** Nx's value comes from inferred targets, executors, and plugins that wrap the underlying tooling. That wrapping is where the friction lands for this specific stack. Expo's toolchain, EAS Build, `expo prebuild`, config plugins and the Metro bundler assume a conventional package layout and a conventional `package.json`. The Nx Expo plugin exists and works, but it inserts a layer between us and Expo's own upgrade path, and Expo ships breaking-ish changes at a fast cadence. When an SDK upgrade breaks, the question becomes "is this Expo or is this the Nx plugin", and for a solo developer that is a bad question to have to answer at 11pm. Prisma's generator and Pulumi's CLI have the same shape of problem to a lesser degree.

**The primary Nx advantage is replaceable; the primary cost is not.** Boundary enforcement is the one thing we would miss, and it can be recovered with two well-configured lint tools that we would want anyway. The plugin-abstraction cost cannot be recovered, because it is inherent to how Nx delivers its value.

**The scale argument does not apply yet.** Nx's compounding advantages, distributed task execution, remote cache at team scale, generators enforcing consistency across dozens of libraries, all activate when there are many projects and many contributors. We have roughly ten packages and one contributor. Adopting the operating model for a scale we do not have is exactly the over-engineering the blueprint's constraints prohibit.

**Reversibility is asymmetric.** Migrating pnpm plus Turborepo to Nx later is a well-trodden path with an official migration tool, because Nx can adopt a conventional workspace. Migrating away from Nx means unwinding inferred targets and executors across every project. Choosing the more conventional option first preserves the option to change; choosing Nx first partly spends it.

### npm workspaces or Yarn

Rejected on a single decisive point that is architectural rather than ergonomic.

[ARCHITECTURE.md §8.2](../ARCHITECTURE.md) treats the absence of a dependency in a `package.json` as the strongest boundary enforcement available, stronger than any lint rule because it cannot be silenced with a comment. `@fp/core` must be unable to import Prisma, NestJS or the AWS SDK.

That guarantee only holds under a strict, non-hoisted `node_modules`. npm and Yarn's classic hoisting flatten transitive dependencies into the workspace root, so `packages/core` can successfully `import { PrismaClient } from '@prisma/client'` purely because `packages/persistence` depends on it. The import resolves, the types work, the build passes, and the domain purity rule is silently dead. This is the phantom dependency problem, and here it is not a hygiene issue, it is the failure of a load-bearing architectural control.

pnpm's symlinked store makes undeclared imports a resolution error. Yarn PnP achieves the same strictness but interacts poorly with React Native's Metro resolver, which is a hard requirement here.

Secondary benefits, disk usage and install speed, are real but would not have decided this on their own.

### Bazel, Moon, Rush

Rejected. Bazel's correctness and hermeticity are excellent and its cost for a TypeScript and React Native workspace with one maintainer is not remotely justified. Moon and Rush are credible but bring smaller ecosystems and no advantage over Turborepo for this shape of workspace.

### Polyrepo

Rejected against the blueprint's stated preference and independently correct here. The mobile app and the API share a wire contract (`packages/contracts`) that changes on nearly every feature. In separate repositories that becomes a publish-and-bump cycle on every change, which in practice means people stop updating the contract and start hand-writing types on the client. The single strongest reason for a monorepo in this product is that the contract and both of its consumers change atomically in one pull request.

## Consequences

### Positive

- Expo, EAS, Prisma and Pulumi run with their own unmodified tooling. Their documentation applies directly.
- Undeclared cross-package imports fail at resolution, making the domain-purity rule real.
- Turborepo's configuration is one `turbo.json` describing task inputs, outputs and dependencies. It can be understood completely in ten minutes and abandoned without a migration.
- Remote caching via Vercel's free tier, or self-hosted on S3, cuts CI time without any workspace restructuring.
- The workspace is conventional, so any TypeScript engineer or coding agent can navigate it without learning a tool-specific model.

### Negative

- **Boundary enforcement is assembled rather than built in.** Two tools must be configured and kept correct. Mitigation: the `dependency-cruiser` rule set is committed with the initial scaffold, its own configuration is covered by a test that asserts known-bad imports fail, and the CI job is a required check.
- **No generators.** Creating a new bounded context is manual. Mitigation: `packages/core/_template/` holds a reference context, and `AGENTS.md` documents the steps. At nine contexts this is not a bottleneck.
- **Turborepo's change detection is hash-based, not graph-semantic.** It can over-invalidate. At this repository size the difference is seconds.
- **React Native plus symlinks needs attention.** Metro has supported symlinks since 0.72 and current Expo SDKs are fine, but native module resolution occasionally is not. Mitigation: the documented `node-linker=hoisted` fallback for `apps/mobile` only, which sacrifices strictness for the one package that has no domain-purity requirement.

### Revisit this decision when

- The workspace exceeds roughly 25 packages, or
- More than 5 engineers work in it concurrently, or
- CI wall time exceeds 15 minutes despite caching, or
- Boundary violations are reaching `main` despite the lint configuration.

Any of these makes Nx's migration path worth taking.

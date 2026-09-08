# Research: Containerized Development Environment

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-08 | **Owning ADR**: [ADR-014](../../adr/ADR-014-containerized-development.md)

ADR-014 fixed the shape (two targets, Debian-slim, container-owned dependency trees, no build-time secrets). This document resolves the mechanics that shape left open, and records three findings that change the design as originally imagined.

---

## 1. Base image, version pinning, and the drift check (FR-014)

**Decision.** `node:24-bookworm-slim`, referenced through a single `ARG NODE_VERSION` at the top of the Dockerfile, with `openssl` and `ca-certificates` installed explicitly. A root script `scripts/verify-node-version.ts` asserts the Dockerfile's major version equals `.nvmrc`, wired into `pnpm verify` and into the existing `verify-env` CI job.

**Rationale.** `.nvmrc` contains `24` and governs the host and CI via `actions/setup-node`. Compose cannot read `.nvmrc`, so the version is necessarily duplicated into the Dockerfile — ADR-014 names this and requires a check rather than a comment. Doing the comparison in TypeScript rather than shell keeps it inside the same typecheck and lint gates as everything else in `scripts/`.

`openssl` is installed rather than assumed: Prisma's query engine links against libssl, Debian slim images carry only what their own packages depend on, and the failure mode when it is absent is a container that builds cleanly and dies at first query. Explicitly installing it costs one layer and removes a class of "works in CI, fails on the VPS" defects.

**Alternatives considered.**

- *Pin by digest (`node:24-bookworm-slim@sha256:…`)* — strictly more reproducible, and correct once Renovate exists to bump it. Rejected for now because a digest nobody updates is a base image that silently stops receiving security patches, which is worse than a floating minor tag. Revisit when Renovate lands (my finding B6); it is a one-line change then.
- *Read `.nvmrc` at build time via a build argument passed from Compose* — removes the duplication entirely, but Compose cannot interpolate a file's contents, so it would require a wrapper script in front of every `docker compose` invocation. That reintroduces exactly the "you must run our script, not Docker" prerequisite this feature exists to remove.
- *Alpine* — rejected in ADR-014. Not reopened.

---

## 2. Producing a production dependency tree from a pnpm workspace

**Decision.** `pnpm deploy --filter @fp/api --prod --legacy /app/deploy` in the build stage, copying the resulting self-contained directory into the runtime stage.

**Rationale.** Verified locally against pnpm 10.33.0: `pnpm deploy` is present, is marked **Experimental**, and exposes a `--legacy` flag. The non-legacy implementation requires `inject-workspace-packages=true` in `.npmrc`, which this workspace does not set — and setting it would change how workspace packages are linked repository-wide, which is a dependency-resolution change with implications for ADR-001's strict linking, not a Docker detail. `--legacy` gets the pruned tree without touching how the workspace resolves anywhere else.

The output matters because of what was verified in §4: workspace dependencies are symlinks that escape their own package directory. A naive `COPY apps/api/node_modules` into a runtime image copies dangling links. `pnpm deploy` exists precisely to flatten that into a self-contained directory.

**Alternatives considered.**

- *Set `inject-workspace-packages=true` and use the modern implementation* — cleaner long-term and drops the `--legacy` flag. Rejected for this feature because it alters workspace linking behaviour for every developer and every existing package to solve a packaging problem, and ADR-001 chose pnpm's strict linking specifically as the strongest of the four boundary-enforcement layers (ARCHITECTURE §8.2). Changing it deserves its own decision, not a side effect.
- *`npm prune --production` or hand-copied `node_modules`* — does not understand workspace protocol links. Produces an image that starts and then fails on the first import from `@fp/persistence`.
- *Bundle the API into a single file (esbuild/ncc) and ship no `node_modules` at all* — genuinely attractive, and smaller. Rejected because Prisma's query engine is a native binary that must be resolved on disk, and bundling NestJS breaks its reliance on decorator metadata and dynamic module resolution. This would be a fight, not a shortcut.

---

## 3. Where the Prisma CLI lives — a third target is required

**Decision.** Three targets, not two: `development`, `runtime`, and **`migrator`**. The `migrator` target carries the Prisma CLI, `schema.prisma` and the `migrations/` directory, and nothing else — no application source, no NestJS, no HTTP server.

**Rationale.** This is the finding that changes the design. Verified: `prisma` (the CLI) is a **devDependency** of `@fp/persistence`, while `@prisma/client` is a runtime dependency. Spec 004's FR-008 requires the runtime target to contain no development dependencies. Those two facts are in direct conflict with running migrations from the runtime image.

It also breaks an assumption already written into a sibling feature: spec 003's plan.md states migrations run via `docker compose run --rm api … prisma migrate deploy`. Against a correctly-built runtime image, that command cannot work, because the binary is not there. Discovering this now costs one extra build stage; discovering it during the first VPS deploy costs a failed deploy against a half-migrated database.

Three targets also produce a better separation than two: the thing that can alter the schema is a different artifact from the thing that serves traffic, so the long-running API image holds no migration capability at all.

**Alternatives considered.**

- *Promote `prisma` to a runtime dependency of `@fp/persistence`* — one-line change, two targets stay. Rejected: it ships a schema-altering CLI inside every running API container, permanently, so that a deploy-time task is convenient. That is a larger standing capability than the problem warrants, and it directly contradicts FR-008.
- *Run migrations from the `development` target* — works, and needs no third stage. Rejected because it means the deploy path depends on an image that contains the full dev toolchain and application source, which is precisely the artifact ADR-014 declines to send to the VPS.
- *Generate raw SQL at build time and apply it with `psql`* — removes Prisma from the runtime path entirely. Rejected: it abandons Prisma's migration history table, so `prisma migrate deploy`'s "which migrations have already run" bookkeeping is lost, and ADR-003 owns that mechanism.

**Consequence to record.** Spec 003's plan.md needs a follow-up amendment to invoke the `migrator` image rather than `run --rm api`. Noted here rather than changed, because that is spec 003's document.

---

## 4. Dependency trees versus bind mounts: pnpm's symlink farm

**Decision.** Bind-mount the repository at `/app`, and declare a **named volume at every workspace package's `node_modules` path** plus the root one — six today. The Prisma client is generated inside the container on first start, never copied from the host.

**Rationale.** Verified locally: `apps/api/node_modules/@fp/persistence` is a symlink to `../../../../packages/persistence`, escaping its own package directory, and real packages live in the root `node_modules/.pnpm` store. A single volume at `/app/node_modules` is therefore not sufficient — a bind mount over `/app` shadows every per-package `node_modules` beneath it, leaving dangling links.

Also verified: the host store currently contains `libquery_engine-darwin-arm64.dylib.node`. That is a macOS binary. Letting it reach a Linux container produces the exact failure ADR-014's Decision 4 predicts, and it presents as an application error rather than a platform mismatch.

**Alternatives considered.**

- *`node-linker=hoisted` in `.npmrc` so a single `node_modules` volume suffices* — much simpler volume wiring. **Rejected firmly.** ARCHITECTURE §8.2 names pnpm's strict, non-hoisted layout as the *strongest* of the four boundary-enforcement layers, the one that "is not a rule that can be disabled with a comment". Flattening it to simplify a Docker volume would delete a constitutional enforcement mechanism (Principle III) to save six lines of YAML.
- *Bind-mount only `src/` directories instead of the whole repository* — no `node_modules` shadowing at all, so no volumes needed. Rejected because `package.json`, `tsconfig.json`, `prisma/schema.prisma` and lockfile changes would then be invisible to the container, and a contributor editing a dependency would get silently stale behaviour — a worse failure than verbose YAML.

**Known cost.** Adding a workspace package requires adding a volume entry. Recorded as a negative rather than solved; the alternative that removes it is the one that deletes a boundary guarantee.

---

## 5. Startup ordering and readiness (FR-002, FR-013)

**Decision.** A one-shot `migrate` service between `postgres` and `api`, using Compose's own dependency conditions:

- `postgres` — existing healthcheck, unchanged
- `migrate` — `depends_on: postgres: {condition: service_healthy}`, runs `prisma migrate deploy`, exits
- `api` — `depends_on: migrate: {condition: service_completed_successfully}`

**Rationale.** This is the containerized equivalent of what `scripts/dev.ts` already does in sequence, and it satisfies both FR-002 ("does not report ready until migrations succeed") and the spec's edge case that a failed migration must never leave a running API against a partial schema — Compose refuses to start `api` when `migrate` exits non-zero. It uses no wait-for-it script, no retry loop, and no fixed sleep.

**Alternatives considered.**

- *Run migrations from the API container's entrypoint* — fewer services. Rejected: with more than one replica it races, and it couples "can this process serve traffic" to "may this process alter the schema", which §3 deliberately separates.
- *`depends_on` without conditions, plus retry-on-connect in the API* — the API should be resilient to a database blip regardless, and that resilience is worth having. But as the *ordering* mechanism it is strictly worse: it cannot distinguish "not up yet" from "migrations failed", so a broken migration yields a crash-looping API instead of a clear stop.

---

## 6. Signals, PID 1, and graceful shutdown (FR-009)

**Decision.** `init: true` in Compose (and `--init` when run directly) to get Docker's own `tini` as PID 1; `app.enableShutdownHooks()` in `main.ts`; an `OnModuleDestroy` hook in `@fp/persistence` calling `prisma.$disconnect()`.

**Rationale.** Two independent defects exist today, and both are load-bearing for FR-009. `main.ts` never calls `enableShutdownHooks`, so Nest registers no `SIGTERM` handler. `packages/persistence/src/client.ts` instantiates `PrismaClient` at module scope and never disconnects it. Separately, a process running as PID 1 does not get the kernel's default signal dispositions: a `SIGTERM` with no registered handler is *ignored*, so `docker stop` would wait its full timeout and then `SIGKILL`. On every redeploy — and spec 003 FR-019 redeploys on every merge to `main` — that drops in-flight requests.

`init: true` is preferred over installing `dumb-init` or `tini` into the image (which ADR-014's prose mentioned as one option) because it adds no package to the image and no `ENTRYPOINT` indirection; Docker supplies the init binary itself.

**Alternatives considered.**

- *Install `dumb-init` in the image* — works identically and survives runtimes that lack an `--init` equivalent. Rejected as the default for being one more package to patch, for a capability the runtime already provides; the Dockerfile stays runtime-agnostic and Compose supplies the flag.
- *Rely on Nest's shutdown hooks alone without an init process* — insufficient. Registering a handler does make the signal deliverable, so this would mostly work; but it makes correct shutdown depend on application code never regressing, with a silent 10-second-then-`SIGKILL` failure mode when it does.

---

## 7. Health check without adding a binary (FR-013)

**Decision.** `HEALTHCHECK` invoking `node --eval` against the existing `/health` endpoint, using Node's global `fetch`.

**Rationale.** Node 24 ships `fetch` globally, so the runtime image needs no `curl` or `wget` — consistent with FR-008's "no build toolchain" posture and one fewer package in the image. `/health` (liveness) is the right target rather than `/health/ready`: readiness depends on the database, and a container should not be reported unhealthy and restarted because a dependency is briefly unavailable.

**Alternative considered.** *`curl --fail`* — universally understood and one line shorter. Rejected only because it means installing curl into an image whose entire point is carrying nothing it does not need.

---

## 8. Build architecture: arm64 development, amd64 deployment

**Decision.** The `development` target builds for the host's native architecture. The `runtime` target is built for `linux/amd64` in CI. No local cross-building is expected or documented.

**Rationale.** Development happens on Apple Silicon (arm64); the VPS is x86-64. Building an amd64 image on arm64 requires QEMU emulation, which is slow enough to be a genuine deterrent. Building the runtime target in CI on `ubuntu-latest` is native amd64 and already required by FR-015.

**Consequence worth stating plainly.** This means the deployable artifact is produced by CI, not by a developer's machine. That sits *underneath* the registry question spec 003 left open (my earlier finding E1) — but it does not decide it, and this feature does not reopen it.

---

## 9. CI: building and health-checking the runtime target (FR-015, FR-016)

**Decision.** One new `image` job: build the `runtime` target with `docker/build-push-action` and GitHub Actions cache, then start it against a `postgres` service container with the `migrator` target applied first, and assert `/health/ready` returns success. No image is pushed anywhere.

**Rationale.** FR-016 exists because a pruned dependency tree is exactly the kind of thing that looks right and fails at import time. Starting the image and reaching `/health/ready` proves the prune was complete, the Prisma engine resolves, and the client can reach a database — the three failure modes §2 and §3 create.

**Naming constraint.** The new job must be *added* alongside the existing six. The repository's branch protection lists required checks by job name, so renaming `verify-env` (the natural place to also run the §1 drift check) would leave `main` waiting forever on a check that no longer reports. The drift check is therefore added as a *step* inside the existing `verify-env` job, and `image` is a new job that must be added to the required list once it is green.

**Alternative considered.** *Build only, do not run* — faster, and catches Dockerfile syntax and missing files. Rejected because it catches none of the three failure modes above, which are the reason FR-016 exists.

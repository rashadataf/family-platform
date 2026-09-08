# ADR-014: The Container Image Is the Unit of Truth, Including on a Developer's Laptop

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

## Context

Three commitments already made by this repository point at a decision that has not actually been taken yet.

[ADR-013](ADR-013-staged-hosting-model.md) states that "container images are identical across both stages" and that what differs between them "is only the target the Pulumi program deploys them to". [ADR-002](ADR-002-modular-monolith.md) commits to two deployables over one shared core. The constitution's own reproducibility argument for Principle X — "an environment that cannot be rebuilt from the repository is an environment that cannot be recovered" — is stated about infrastructure, but the reasoning does not stop at the VPS boundary.

Against those commitments, the current state is:

- **No Dockerfile exists anywhere in the repository.** `docker-compose.yml` runs PostgreSQL and nothing else.
- `scripts/dev.ts` runs the API on the host through `tsx`, and `docs/local-development.md` correctly tells a newcomer to install Node.js 24 and pnpm 10 first. The claim in that document that Docker means "nothing else needs to be installed manually" is true only of the database.
- Spec 003 (VPS staging deployment) does plan a Dockerfile, but as FR-018 — a secondary requirement of a *deployment* feature, justified by "so the founder can run the fully containerized stack locally".

That last point is the actual decision this ADR exists to correct. FR-018 has the dependency backwards. If the image is the artefact that runs in every environment, then the image is foundational and the staging deploy is one of its consumers — not the reverse. An image introduced as a deploy-time side effect is an image whose failures are discovered at deploy time, which is the furthest possible point from the person who caused them.

There is also a plainly stated goal that no existing document records: **a new teammate should need Docker installed and nothing else.** No Node.js, no pnpm, no version manager, no Java, no per-language toolchain. That is a real architectural requirement — it sets the onboarding cost of this project, and onboarding cost is what determines whether the project can ever have a second contributor — and it has never been written down or defended.

## Decision

**The container image is the unit of truth for how this application runs, in every environment, including a developer's laptop. The host toolchain is an optimisation, never a prerequisite.**

Concretely:

**1. `docker compose up` is the supported way to run this project, and the first thing the documentation says.** From a clean machine with only Docker installed, a clone plus `cp .env.example .env` plus `docker compose up` yields a working, hot-reloading API against a migrated database. Node.js and pnpm on the host become optional, and `docs/local-development.md` must list them as such.

**2. One Dockerfile per deployable, multi-stage, with two named targets.**

| Target | Runs where | Contains |
|---|---|---|
| `development` | A contributor's machine, via Compose | Whole workspace, pnpm, dev dependencies, source bind-mounted from the host, file-watch reload |
| `runtime` | Staging today, AWS at Stage 1 | Pruned production dependency tree, compiled output, non-root user, no package manager, no build toolchain, no source |

Both targets derive from the same base stage, so the runtime one cannot silently diverge in Node version, system libraries or locale from the one people develop against.

**3. The founder's existing host-based loop (`pnpm dev`) is kept, and is explicitly the second-class path.** It is faster on macOS, where bind-mount filesystem performance is a real cost, and the person who works in this repository daily should not pay that cost. It is retained as a documented optimisation for someone who already has the toolchain, not as the path a newcomer is asked to take.

**4. `node_modules` never crosses the container boundary.** Dependency trees live in named volumes owned by the container, and only source is bind-mounted. A host `node_modules` built for macOS arm64 mounted into a Linux container produces failures that look like application bugs, and native binaries — Prisma's query engine and esbuild, the two this workspace already declares under `onlyBuiltDependencies` — are exactly the packages that break this way.

**5. The runtime image is Debian-slim, not Alpine.** Prisma ships separate query-engine binaries per libc, and an Alpine base requires `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` in the schema plus a matching OpenSSL version, with a failure mode that appears at container start rather than at build. The saving is roughly 80 MB on an image that is transferred over SSH once per deploy to a single VPS. That is not a trade worth a class of runtime failure.

**6. The Node.js version has exactly one source of truth, and a check enforces it.** `.nvmrc` governs the host and CI. The Dockerfile pins the same major version. Because Compose cannot read `.nvmrc`, this is a duplication that drift will eventually find, so a check in the standard gate set asserts the two agree. A convention that only a comment protects is not a convention.

**7. Secrets never appear at image build time.** No `ARG` carries a credential, no `.env` enters the build context. This is [Principle X](../.specify/memory/constitution.md) applied to images specifically: build arguments are recoverable from image metadata by anyone holding the image, and under ADR-013 the image is transferred whole to a VPS that also hosts an unrelated public site.

**8. Every workspace command has a container-native form.** `docker compose run --rm api pnpm <command>` runs any script — tests, migrations, generators — for a contributor who has no pnpm. Documentation that gives only the host form silently reintroduces the prerequisite this ADR removes.

**Explicit limit.** This decision covers server-side deployables — `apps/api` today, `apps/worker` when it arrives. It does **not** extend to `apps/mobile`. Expo development requires host-native simulators and platform SDKs, and pretending otherwise would be a lie told by an architecture document. When the mobile app lands, "Docker and nothing else" will be true for the backend and false for mobile, and the documentation must say so plainly rather than let a newcomer discover it.

## Alternatives considered

### Keep host-based development; containerize only for deployment (the status quo, and spec 003's FR-018) — rejected

The honest argument for it is speed: native filesystem access and no container layer, which on macOS is a meaningful daily difference.

Rejected because it makes the image a deploy-time artefact. Under spec 003 the image is built and shipped on merge to `main` (FR-019), so the first time anyone exercises a change to the runtime image is after the merge gate has already passed. Every image defect — a missing system library, a broken production dependency prune, a Prisma engine that resolves locally and not in the image — is then discovered in a deploy, by the person least placed to debug it, against an environment nobody is watching. Retaining the fast host loop as a *second* path, which this decision does, keeps the benefit without accepting that failure mode.

### VS Code Dev Containers as the mechanism — rejected as the mechanism, permitted as a wrapper

`devcontainer.json` gives a genuinely excellent experience: the editor, extensions, language server and terminal all inside the container.

Rejected as the primary contract for two reasons. It couples the project's onboarding story to one editor, and a contributor using something else is back to installing a toolchain. More importantly it produces a *development environment*, not the artefact that ships — so it would solve teammate onboarding while leaving the "the image is only ever exercised at deploy time" problem completely untouched. A `devcontainer.json` that points at the `development` target of this same Dockerfile is a welcome future addition, and costs nothing once this decision is in place.

### Nix, or a host version manager (mise, asdf, Volta) — rejected

These solve version drift properly and are lighter than a container for pure toolchain pinning.

Rejected because they solve a different problem from the one stated. The requirement is not "everyone runs the same Node version", it is "a contributor installs one thing". A version manager still requires the language runtime, the package manager, a working native build chain for Prisma and esbuild, and a running PostgreSQL from somewhere. Nix additionally imposes a learning cost far exceeding Docker's on anyone who has not used it. And neither produces the image that runs in staging, so the divergence this ADR is about would remain.

### A single-stage image used for both development and production — rejected

Simpler, one thing to maintain, no risk of the two targets drifting.

Rejected on Principle VI's posture. That image ships pnpm, the full dev dependency tree, the TypeScript compiler and the application's own source to a VPS that also hosts a public site — a materially larger attack surface and a much larger transfer on every deploy, in exchange for avoiding roughly thirty lines of Dockerfile. The two targets sharing a base stage addresses the drift objection at a fraction of the cost.

### Alpine base for the runtime image — rejected

Covered under Decision point 5. Roughly 80 MB, against a Prisma libc failure mode that surfaces at container start. Revisit only if image transfer size becomes an actual measured constraint, which under ADR-013's single-VPS, occasional-deploy model it is not.

## Consequences

### Positive

- Onboarding for a backend contributor becomes: install Docker, clone, `cp .env.example .env`, `docker compose up`. That is the stated goal, and it is now a property the repository has rather than an aspiration.
- The runtime image is exercised on every developer machine and in CI, not only at deploy. ADR-013's "container images are identical across both stages" claim becomes continuously tested instead of assumed.
- Spec 003's deploy path gets strictly simpler: it consumes an image that already exists and already works, rather than introducing one.
- The `apps/worker` deployable ADR-002 anticipates costs one additional Dockerfile following an established, proven shape.

### Negative

- **Bind-mount filesystem performance on macOS and Windows.** Real, and the reason the host loop is retained rather than deleted. Mitigation: source is bind-mounted but `node_modules`, build output and caches are container-owned named volumes, which removes the pathological case; the founder keeps `pnpm dev`.
- **Two build targets that can drift.** Mitigation: a shared base stage, and CI building the `runtime` target on every pull request — an image that is only built on `main` is an image that breaks on `main`.
- **A duplicated Node version** between `.nvmrc` and the Dockerfile, which Compose's inability to read `.nvmrc` forces. Mitigation: Decision point 6's check, in the standard gate set. Named here rather than left as a comment, because it is the most likely thing on this list to silently rot.
- **Docker becomes a hard prerequisite for all backend work**, where previously a developer with the toolchain could in principle run the API against an external database. Accepted deliberately: Docker was already required for the database, so this narrows an existing dependency rather than adding one.
- **Slower first run.** A cold `docker compose up` builds an image; `pnpm install` on a warm host cache does not. Mitigation: layer ordering that puts the dependency install above the source copy, so ordinary code changes never re-resolve dependencies.
- **"Docker and nothing else" will become partially false** when `apps/mobile` arrives. Named in the Decision's explicit limit so that it is a known boundary rather than a broken promise.

### Revisit this decision when

- `apps/mobile` lands, and the onboarding documentation has to describe two different setups honestly.
- Bind-mount performance is measured, not merely felt, to be the dominant cost in the development loop — at which point a watch-and-sync mechanism replaces the bind mount, without reopening this decision.
- A second contributor actually onboards. The first real run of the process is the only honest test of it, and whatever they get stuck on is a defect in this decision, not in them.
- Image transfer size becomes a measured constraint on deploys, which would reopen the Alpine question and, before it, the registry question ADR-013 left open.

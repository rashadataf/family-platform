# Research: VPS Staging Deployment

Phase 0 output for [plan.md](plan.md). Each decision follows Decision / Rationale / Alternatives
considered.

## 1. Image build and transfer mechanism

**Decision**: Build the API image locally (on whichever machine runs `pulumi up` — the founder's
laptop or the CI runner) using Pulumi's `docker` provider (`@pulumi/docker-build`, the current
BuildKit-based build resource), `docker save` it to a tarball, transfer that tarball to the VPS
using `@pulumi/command`'s `remote.CopyToRemote`, then `docker load` it on the VPS and orchestrate
containers there via `command.remote.Command` running plain `docker compose` invocations over SSH.

**Rationale**: This is the literal reading of ADR-013's "command (remote execution over SSH) and
docker providers" — `docker` builds, `command` does everything that happens on the far side of the
SSH connection. It satisfies the "no registry" clarification (FR-002) without inventing a new
mechanism: the image never leaves the two machines it needs to be on. `docker compose` reuses the
same service definitions spec 004 delivers in the repository's `docker-compose.yml` (FR-018), so
there is exactly one place service topology is described, not two.

**Alternatives considered**:
- **Point the `docker` provider itself at the VPS's daemon over SSH** (`new docker.Provider('vps', { host: 'ssh://user@host' })`, per the [Pulumi Docker provider's documented SSH support](https://www.pulumi.com/registry/packages/docker/installation-configuration/)), and drive `docker.Network` / `docker.Volume` / `docker.Container` as native Pulumi resources instead of shell commands. This was the initial design and is more idiomatic — it gives real per-resource Pulumi tracking and would let `pulumi.protect` apply directly to the Postgres volume. Rejected after research surfaced multiple open, unresolved issues against `pulumi-docker`'s SSH transport specifically ([#1293](https://github.com/pulumi/pulumi-docker/issues/1293), connection refused over SSH despite the identical command working outside Pulumi; [#1147](https://github.com/pulumi/pulumi-docker/issues/1147), `pulumi refresh` ignoring the `docker:host` SSH setting; a regression in 4.3.1 breaking `RemoteImage` pulls over SSH). For a solo operator whose entire point in choosing Pulumi was avoiding exactly this kind of wedged, hard-to-debug state (see ADR-004's CDK rejection rationale about CloudFormation), a provider-level SSH transport with known open connectivity bugs is the wrong foundation. The `command` provider's SSH usage is simpler (literally SSH plus shell) and far more battle-tested.
- **Push to a registry** — rejected in `/speckit-clarify` (Session 2026-09-08, Q1); superseded by this decision.
- **`docker-compose.yml`'s own `build:` directive run directly on the VPS via `command.remote.Command`, transferring source instead of an image** — would need the full build context (source, `node_modules` or a build stage) on the VPS rather than just the finished artifact, is slower on every deploy, and makes the VPS a build machine, which is more surface than a personal VPS shared with another site should carry. Rejected in favor of building once, elsewhere, and shipping only the finished image.

## 2. Migration ordering relative to container replacement

**Decision**: Migrate before swap. On every deploy: (1) load the new images on the VPS without
touching running containers, (2) run `docker compose run --rm migrate` — the one-shot service spec
004 already built from the `migrator` target, carrying the Prisma CLI, schema and migrations and
nothing else (ADR-014) — against the still-running Postgres, (3) only if that succeeds, recreate
the `api` service with the new `runtime` image (`docker compose up -d`). Postgres itself is
untouched by an ordinary deploy.

> **Correction (issue #9), found during spec 004's implementation.** This section originally read
> `docker compose run --rm api ... prisma migrate deploy`. That cannot work: spec 004 FR-008
> requires the `api` runtime image to carry no dev dependencies, and `prisma` (the CLI, as opposed
> to `@prisma/client`) is one — verified empirically, the runtime image does not contain it. The
> `migrator` target and its one-shot `migrate` Compose service exist for exactly this reason and
> already implement the ordering this section describes; this feature invokes that service rather
> than inventing a second migration path.

**Rationale**: This is the only ordering that satisfies FR-009 (a failed migration must leave the
previous known-good deployment running, not present a broken deploy as ready) when there is no
blue/green infrastructure to fall back on — a single VPS container either serves traffic or it
doesn't, so the old one must not be torn down until the new schema is proven to apply. It mirrors
`scripts/dev.ts`'s own `migrate()`-then-`startApi()` ordering, just with an extra "on the *new*
image, against the *old* container" twist that local dev doesn't need because local dev has no
concept of swapping a running process for a new one.

**Alternatives considered**: Migrate after swap (recreate the container, then migrate) — rejected outright, this is exactly what FR-009 forbids: a window where the new code is live against an unmigrated schema. Running migrations from a long-lived sidecar instead of a one-off container — rejected as unnecessary process for something that runs once per deploy and exits.

## 3. Deletion protection given command-driven (not resource-driven) container lifecycle

**Decision**: No `pulumi.protect` flag, because there is no discrete Pulumi resource representing
the Postgres volume to attach one to (§1's decision manages it via shell commands, not typed
resources). Instead, protection is procedural: an ordinary deploy (`pnpm staging:deploy`) never
touches the Postgres volume or the `postgres` compose service at all — only the explicit,
separately-invoked reset option (FR-012) or the separately-invoked teardown command (FR-007/013)
can remove it, and both require deliberately choosing a different command than the one used for
routine iteration.

**Rationale**: Constitution Principle X requires deletion protection on stateful resources; its
stated rationale is an environment that cannot be rebuilt cannot be recovered. Here recovery is
cheap and expected — the environment is explicitly disposable and fixture-seeded — but *accidental*
loss during routine redeploys is still worth preventing, which command-separation achieves without
requiring a resource type this design doesn't have. This is flagged explicitly (rather than
silently substituted) in the plan's Constitution Check.

**Alternatives considered**: Adopting §1's rejected alternative (native `docker.Volume` with
`protect: true`) solely to get literal `pulumi.protect` — rejected because it would mean accepting
the SSH-transport risk from §1 for a protection guarantee that command-separation already provides
by a different, more reliable mechanism.

## 4. Secrets mechanism

**Decision**: Pulumi Cloud's encrypted stack configuration (`pulumi config set --secret`) is the
single source of truth for every secret this stack needs (VPS SSH private key, SSH user/host,
Postgres password). CI needs exactly one secret of its own, `PULUMI_ACCESS_TOKEN` (a GitHub Actions
encrypted secret), to authenticate the Pulumi CLI to Pulumi Cloud; Pulumi resolves and decrypts the
rest at apply time. Values are passed to remote commands through `command.remote.Command`'s typed
`environment` input, never written to a file on the VPS or interpolated into a logged shell string.

**Rationale**: ADR-004 already fixed "state in Pulumi Cloud" as the state backend, and the founder's
own prior Pulumi/VPS experience (cited in ADR-013's context) already used this pattern for the
portfolio site — reusing it means zero new secret-storage surface for this feature, and it
satisfies FR-006 (sourced from the mechanism already securing the VPS), FR-016 (not committed), and
Constitution Principle X ("secrets... not committed, logged, or passed as build arguments; resolved
at runtime from the designated secret store") simultaneously. Keeping the CI secret surface to just
one token also minimizes what a compromised CI configuration could expose.

**Alternatives considered**: GitHub Actions encrypted secrets holding the SSH key and DB password
directly (bypassing Pulumi config) — rejected as a second, parallel secret store alongside Pulumi
Cloud's, doubling the places a secret can drift or leak, for no benefit over letting Pulumi Cloud
hold everything and CI hold only the token needed to ask for it.

## 5. Testing approach for the infrastructure package

**Decision**: `infrastructure/` gets a `test` script consistent with every other workspace package
(wired into `turbo run test`), initially covering one concrete invariant with Pulumi's mock testing
harness (`@pulumi/pulumi/testing`): that the staging network resource/config is never named or
configured identically to a value that would collide with the portfolio site's own containers, and
that no resource in the program declares a `docker:host` pointing anywhere but the configured VPS.
Deeper infrastructure testing (e.g., asserting the full compose topology) is deferred rather than
built speculatively, per ADR-004's "component abstractions... third repetition" discipline applied
to test scaffolding as much as to code.

**Rationale**: The constitution's merge-gate table lists "Unit tests" and "Infrastructure
validation and preview" as both required; the latter is satisfied by `pulumi preview` in CI (see
plan.md's CI design), but the former needs at least one real assertion, not an empty stub, or the
gate is theater. One well-chosen invariant beats a large speculative suite for a feature this size.

**Alternatives considered**: No tests at all for `infrastructure/` (matching `apps/api`'s current
`"echo no tests yet"` stub) — rejected because, unlike `apps/api` at this stage, this feature's
core risk (accidentally colliding with the portfolio site) is exactly the kind of thing a cheap
mock-based assertion catches before it ever reaches the VPS.

## 6. Clarifying "no registry" against the base images this stack still pulls

Not a decision so much as a scope note, recorded here to prevent a future misreading: FR-002's "no
intermediate container registry" governs only the image *this feature builds* (the API). The
`postgres:16-alpine` base image already pulled by `docker-compose.yml` continues to be pulled
directly from Docker Hub by the VPS's own Docker daemon, exactly as it already is by every
developer's local machine today. That is an ordinary public-image pull, not the kind of
project-operated registry infrastructure the clarification declined to introduce.

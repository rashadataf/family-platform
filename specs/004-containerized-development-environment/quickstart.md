# Quickstart: Validating the Containerized Development Environment

**Feature**: [spec.md](spec.md) | **Contract**: [contracts/cli-and-compose.md](contracts/cli-and-compose.md)

Runnable scenarios that prove this feature works. Each maps to numbered requirements and success criteria. Run them in order — later ones assume earlier ones passed.

---

## Prerequisites

For scenarios 1–5: **Docker with Compose. Nothing else.** That is the point of the feature; installing anything more invalidates scenario 1.

For scenario 6 only: Node.js 24 and pnpm 10.

---

## Scenario 1 — Cold start with only Docker (FR-001, FR-002, SC-002, SC-004)

**The honest version of this test needs a machine, VM or container that has never run this project and has no Node.js or pnpm on `PATH`.** Running it on the development machine proves layer caching works, not that onboarding works.

```sh
git clone <repo-url> && cd family-platform
cp .env.example .env
docker compose up
```

**Expected:**
- Postgres starts and becomes healthy
- `migrate` runs `prisma migrate deploy`, applies every committed migration, exits 0
- `api` starts only after that, and logs its listening port
- Under 15 minutes cold, including the image build (SC-004)

```sh
curl http://localhost:3000/health        # {"status":"ok"}
curl http://localhost:3000/health/ready  # {"status":"ok"}
```

`/health/ready` succeeding is the meaningful assertion: it proves the container reached a migrated database.

---

## Scenario 2 — Hot reload (FR-003, SC-003)

With scenario 1 running, edit any file under `apps/api/src/`. Expected: the API restarts within seconds, no rebuild, no manual restart.

> **If this fails**, file-watch events are not crossing the bind mount — a known risk on Docker Desktop (research §4). The fallback is polling, and if it is needed it must be documented rather than left for the next person to rediscover.

---

## Scenario 3 — Workspace commands without pnpm on the host (FR-004)

```sh
docker compose run --rm api pnpm test
docker compose run --rm api pnpm lint
docker compose run --rm api pnpm --filter @fp/persistence exec prisma migrate status
```

Expected: each runs and propagates its exit code. A contributor with no pnpm is never blocked.

---

## Scenario 4 — Failure modes are legible (spec.md Edge Cases)

| Do this | Expected |
|---|---|
| `rm .env` then `docker compose up` | Fails naming `.env` and the template, not an opaque container error |
| Set `DATABASE_URL=not-a-url` in `.env` | Container exits at start naming `DATABASE_URL` — never on a later request (Principle II) |
| Add a deliberately broken migration | `migrate` exits non-zero; **`api` never starts**; nothing serves against a partial schema |
| Occupy port 3000, then `docker compose up` | Fails naming the port and how to change it |

The third row is the important one — verify `docker compose ps` shows no running `api`.

---

## Scenario 5 — Graceful shutdown (FR-009)

```sh
docker compose up -d
docker compose stop api   # time this
```

**Expected: the container exits in well under 10 seconds.** If it takes exactly ~10s, `SIGTERM` was ignored and Docker fell back to `SIGKILL` — meaning `init: true` or the shutdown hooks are not working (research §6). In-flight requests should complete; database connections should close cleanly.

---

## Scenario 6 — The host path still works (FR-017, FR-018, SC-008)

On a machine with the host toolchain:

```sh
docker compose down     # avoid the documented port conflict
pnpm install
pnpm dev
```

Expected: behaves exactly as `docs/local-development.md` describes today. Then confirm shared state:

```sh
# create data via the host path, stop it, start the container path
docker compose up -d
# the same data is present — same database, same volume, no reset needed
```

---

## Scenario 7 — The runtime image is what CI says it is (FR-008, FR-015, FR-016, SC-006)

```sh
docker build --target runtime -t fp-api:runtime -f apps/api/Dockerfile .

docker run --rm fp-api:runtime sh -c 'command -v pnpm || echo ABSENT'   # ABSENT
docker run --rm fp-api:runtime sh -c 'command -v prisma || echo ABSENT' # ABSENT
docker run --rm fp-api:runtime whoami                                    # node, not root
docker run --rm fp-api:runtime sh -c 'ls src 2>/dev/null || echo ABSENT' # ABSENT
```

Then start it against a migrated database and confirm `/health/ready` returns success. That last step is the one that catches an incomplete production dependency prune — the failure this whole target shape exists to prevent (research §2, §3).

> On Apple Silicon this builds arm64. CI builds `linux/amd64`, which is what the VPS needs. Do not cross-build locally (research §8).

---

## Scenario 8 — Version drift is caught (FR-014, SC-007)

```sh
pnpm verify:node-version        # passes
# temporarily change the Dockerfile's NODE_VERSION to 22
pnpm verify:node-version        # fails, naming both values
# revert
```

---

## Scenario 9 — The documentation is correct (SC-001)

**Not verifiable by the author.** Someone who wrote the setup cannot un-know it.

Give the repository to a person who has never onboarded. Watch them work from `docs/local-development.md` alone. Do not answer questions — **write them down instead**. Every question they need to ask is a documentation defect, and the list of questions is this scenario's output.

Passing means: they reach a successful `/health/ready` with zero questions answered.

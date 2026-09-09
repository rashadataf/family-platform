# Local Development

## Prerequisites

**[Docker](https://www.docker.com/) with Docker Compose. That is the whole list.**

You do not need Node.js, pnpm, a version manager, or PostgreSQL installed. The container carries all of them.

> **What this does not cover.** This guarantee is for backend work — `apps/api`, and `apps/worker` when it exists. It will **not** extend to the mobile app. Expo requires host-native simulators and platform SDKs that cannot live in a Linux container, so when `apps/mobile` lands it will have its own prerequisites. Better to know that now than to discover it later. See [ADR-014](../adr/ADR-014-containerized-development.md).

## From a fresh clone to a running environment

```sh
git clone <repo-url>
cd family-platform
cp .env.example .env
docker compose up
```

That is the supported path, and it is the one to use if you are new here.

`docker compose up` starts three things, in order, and each waits for the one before it:

1. **`postgres`** — PostgreSQL 16, and waits until it actually accepts connections.
2. **`migrate`** — applies every committed migration, then exits. If a migration fails, **the API never starts.** That is deliberate: a partially migrated schema must never be served.
3. **`api`** — the API, watching your source for changes.

Once it is up:

```sh
curl http://localhost:3000/health        # {"status":"ok"}
curl http://localhost:3000/health/ready  # {"status":"ok"} — proves the database is migrated and reachable
```

Edit anything under `apps/api/src/` and the API restarts on its own. No rebuild, no restart.

## Running commands without pnpm installed

Any workspace command runs inside the container:

```sh
docker compose run --rm api pnpm test
docker compose run --rm api pnpm lint
docker compose run --rm api pnpm --filter @fp/persistence exec prisma migrate status
```

The exit code is passed through, so these work in scripts too.

## Tests come in two tiers

| Command | Runs | Needs a database |
|---|---|---|
| `pnpm test` | The unit tier — everything under `apps/`, `packages/` and `scripts/` except `*.integration.spec.ts` | **no** |
| `pnpm test:integration` | Only `*.integration.spec.ts`, against a real, migrated PostgreSQL | **yes** |
| `pnpm boundaries` | The architecture's allowed-edge graph, and cycle detection | no |

Both test commands work identically on both paths, with no path-specific flags:

```sh
docker compose run --rm api pnpm test:integration   # containerized
pnpm test:integration                               # host
```

**`pnpm test` must stay runnable with no database at all.** That is the whole point of the split: the tier you run every few minutes has to be fast, and it stops being fast the moment it needs a service to be up. If you find yourself reaching for a database in a `*.spec.ts`, the test belongs in a `*.integration.spec.ts` instead.

The integration harness derives its database by suffixing the one in `DATABASE_URL` — `family_platform` becomes `family_platform_test` — creates it if absent, and applies every committed migration to it. **It never touches your development database.** A suite that empties the database you were just working in is one people learn not to run.

Each test runs inside a transaction that is rolled back afterwards, so tests start clean and cannot see each other's writes.

## Checking the architecture boundaries

```sh
pnpm boundaries
```

This validates every import in the repository against the allowed-edge graph in [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs), and detects dependency cycles. It **fails closed**: an import matching no rule is an error, so a new package is a violation until the graph knows about it.

Your editor will also flag a forbidden import as you type it, via `eslint-plugin-boundaries`. That is for speed, not authority — a per-file linter cannot see a cycle that spans packages, and a lint rule can be silenced with a comment. `pnpm boundaries` cannot. If the two ever disagree, it is right.

To change a boundary, edit the rule set. That is a reviewable diff in one file, which is the point.

To author a **new** migration (an interactive workflow — it prompts you for a name):

```sh
docker compose run --rm api pnpm --filter @fp/persistence exec prisma migrate dev
```

## Stopping, restarting, and resetting

These are different operations. Don't confuse them:

| Goal | Command | What happens to your data |
|---|---|---|
| Stop everything | `docker compose down` | **Kept.** The database volume is untouched. |
| Stop everything and wipe the database | `docker compose down -v` | **Destroyed.** Next `up` rebuilds from migrations. |
| Restart just the API | `docker compose restart api` | Kept |
| Watch the logs | `docker compose logs -f api` | — |

## The host-based path (optional)

If you already have **Node.js 24** and **pnpm 10** installed, `pnpm dev` still works and is faster.

It avoids the container filesystem layer, which on macOS is a real difference in day-to-day feel. This is an optimisation for people who already have the toolchain — not the route to recommend to someone new, and not required for any task.

```sh
docker compose down   # see the port note below
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres in Docker, applies migrations, and runs the API on your host with watch reload. Its companions are unchanged: `pnpm dev:down`, `pnpm db:reset`, `pnpm db:migrate:create`.

**Both paths share the same database.** Same Postgres service, same volume, same migrations — switch between them freely, no reset needed.

> **`DATABASE_URL` and `PORT` in `.env` do not affect the container path.** Compose overrides both: inside the network the database host is `postgres`, not `localhost`, and the container always listens on 3000 (`PORT` only chooses which host port maps to it). One `.env` cannot describe both paths, so the container's values are set in `docker-compose.yml` instead. Every other variable in `.env` is passed through unchanged.

> **Port conflict.** Both paths publish the API on the same host port, so **they cannot run at the same time**. Starting the second one fails with a port-binding error. This is intended: the alternative would be two environments quietly diverging. Run `docker compose down` before `pnpm dev`, or stop `pnpm dev` before `docker compose up`.

## Adding a new package

A new package under `packages/` or `apps/` should extend the three shared configuration packages rather than defining its own rules:

- **TypeScript**: `"extends": "@fp/config-typescript/base.json"` in `tsconfig.json` (or `@fp/config-typescript/nestjs.json` for a NestJS app).
- **ESLint**: `import fpConfig from '@fp/config-eslint';` and export it (optionally extended) from `eslint.config.js`.
- **Prettier**: nothing to add — the root `package.json`'s `"prettier": "@fp/config-prettier"` field already covers every package.

**You must also declare it in three places.** `pnpm verify:workspace` checks all three and runs in CI, so you will be told rather than left to discover it:

1. A `COPY` line for its `package.json` in [`apps/api/Dockerfile`](../apps/api/Dockerfile)'s `deps` stage.
2. A named volume for its `node_modules` in [`docker-compose.yml`](../docker-compose.yml), mounted on the `api` service.
3. An entry in `WORKSPACE_GRAPH` in [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs), saying which packages it may import.

Step 3 is the boundary gate's fail-closed behaviour: until the graph knows about the package, every import into or out of it is an error. That is deliberate — a boundary system that silently ignores what it has not been told about guarantees nothing.

Step 1 is the one that is easy to miss and expensive to diagnose. Without it the image installs no dependencies for the package, and the containerized path dies with `Cannot find package '@fp/…'` — which reads like a broken install rather than a missing line in a Dockerfile, and which a contributor working on the host path never sees at all.

Step 2 is not optional and not decorative. pnpm links workspace packages by symlink, and those symlinks point outside their own directory — so a package without its own volume gets its `node_modules` shadowed by the source bind mount, and its imports break in ways that look like application bugs. The comment block at the bottom of `docker-compose.yml` explains why the simpler one-volume alternative is rejected.

## Troubleshooting

| Symptom | What's happening | What to do |
|---|---|---|
| `env file .env not found` | You haven't created your local environment file | `cp .env.example .env`, then re-run |
| Port already in use | Something else is on that port — often the *other* development path | Stop it, or change `PORT` / `POSTGRES_PORT` in `.env` |
| The API never starts, `migrate` shows an error | A migration failed | Read the Prisma error in `docker compose logs migrate`. The API is deliberately not started — a partially migrated environment must never be reported ready |
| Container exits immediately naming a variable | A required value is missing or invalid in `.env` | Fix that value. See `apps/api/src/config/env.schema.ts` for what's required |
| Source edits don't trigger a restart | File-watch events aren't crossing the bind mount | Restart the container. If it persists, this is a known Docker Desktop issue — raise it, because the fallback (polling) belongs in this document rather than in your head |
| Imports of `@fp/*` fail after adding a package | You added a workspace package without its `node_modules` volume | See "Adding a new package" above |
| `pnpm dev` says Docker isn't reachable | Docker isn't running | Start Docker, then re-run |

## Why it works this way

[ADR-014](../adr/ADR-014-containerized-development.md) records the decision and the alternatives that were rejected. The short version: the container image is what runs in every environment, including staging, so it should be what you develop against too — otherwise its defects are only discovered at deploy time, by whoever is least placed to debug them.

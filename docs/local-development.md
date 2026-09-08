# Local Development

## Prerequisites

- [Node.js](https://nodejs.org/) 24.x (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 10.x (`corepack enable` will pick up the version pinned in `package.json`)
- [Docker](https://www.docker.com/) with Docker Compose (used to run local Postgres — nothing else needs to be installed manually)

## From a fresh clone to a running environment

```sh
git clone <repo-url>
cd family-platform
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` does everything in one command:

1. Starts a local PostgreSQL 16 container (Docker Compose).
2. Applies every committed database migration.
3. Starts the API, watching for source changes and restarting automatically.

Once it's running, confirm it worked:

```sh
curl http://localhost:3000/health        # {"status":"ok"}
curl http://localhost:3000/health/ready  # {"status":"ok"} once the database is migrated
```

Edit anything under `apps/api/src/` while `pnpm dev` is running and the API restarts on its own — no need to stop and re-run the command.

## Stopping, restarting, and resetting

These are three different operations — don't confuse them:

- **Stop the API, keep the database running**: press <kbd>Ctrl+C</kbd> in the terminal running `pnpm dev`. The Postgres container is left running in the background; the next `pnpm dev` reattaches instantly.
- **Stop everything, keep the data**: `pnpm dev:down`. This stops the Postgres container but never touches its data volume — your local data is still there next time you run `pnpm dev`.
- **Reset the database to a clean state**: `pnpm db:reset`. This destroys the database's data volume, recreates the container from nothing, and reapplies every committed migration. Use this when your local data has drifted into a state you don't want, or you just want a clean slate. **All local data is lost.**
- **Author a *new* migration**: `pnpm db:migrate:create`. This is a distinct, interactive workflow (`prisma migrate dev` under the hood) that diffs `packages/persistence/prisma/schema.prisma` against your running database, prompts you for a migration name, and writes + applies the new SQL file. Don't confuse this with what `pnpm dev` does internally (`prisma migrate deploy`, which only *applies* already-committed migrations and never generates new ones).

## Adding a new package

A new package under `packages/` or `apps/` should extend the three shared configuration packages rather than defining its own rules:

- **TypeScript**: `"extends": "@fp/config-typescript/base.json"` in `tsconfig.json` (or `@fp/config-typescript/nestjs.json` for a NestJS app).
- **ESLint**: `import fpConfig from '@fp/config-eslint';` and export it (optionally extended) from `eslint.config.js`.
- **Prettier**: nothing to add — the root `package.json`'s `"prettier": "@fp/config-prettier"` field and the root `prettier --check .` / `prettier --write .` scripts already cover every package.

No package should carry its own copy of strict-mode compiler options, lint rules, or formatting rules.

## Troubleshooting

| Symptom | What's happening | What to do |
|---|---|---|
| `pnpm dev` says no `.env` file found | You haven't created your local environment file yet | `cp .env.example .env`, then re-run `pnpm dev` |
| `pnpm dev` says Docker isn't reachable | Docker isn't installed, or the daemon isn't running | Install/start Docker, then re-run `pnpm dev` |
| `pnpm dev` says a port is already in use | Something else on your machine is already using the configured Postgres port | Stop the other process, or set a different `POSTGRES_PORT` in `.env` (and update `DATABASE_URL` to match), then re-run |
| `pnpm dev` recovers from a "stale container" state on its own | The Postgres container was left in a stopped/broken state from a previous run | No action needed — this is automatic. If it keeps happening, `pnpm db:reset` |
| `pnpm dev` reports a migration failure and stops before starting the API | A migration didn't apply cleanly | Read the Prisma error above the failure message; the API is deliberately never started in this case, since a partially-migrated environment must never be reported as "ready" |
| `pnpm dev` fails immediately naming a specific environment variable | A required value is missing or invalid in your `.env` | Fix that value; see `apps/api/src/config/env.schema.ts` for what's required |

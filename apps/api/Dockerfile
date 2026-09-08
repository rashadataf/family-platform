# syntax=docker/dockerfile:1

# Build context is the REPOSITORY ROOT, not apps/api — the workspace lockfile
# and sibling packages are required. Filtered by the root .dockerignore, which
# excludes .env and .env.* so no credential can reach an image layer (FR-012).
#
# Targets:
#   development  contributor's machine, via Compose. Source bind-mounted.
#   runtime      the deployable. No package manager, no source, no Prisma CLI.
#   migrator     one-shot `prisma migrate deploy`. Nothing else.
#
# Kept in sync with .nvmrc by `pnpm verify:node-version` (FR-014). Compose
# cannot read .nvmrc, so this duplication is forced; the check is what keeps
# it honest.
ARG NODE_VERSION=24

# ---------------------------------------------------------------------------
# base — the single place the platform is decided. Every target derives from
# this, so runtime cannot drift from what people develop against.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base

# openssl is installed explicitly rather than assumed. Prisma's query engine
# links against libssl, Debian slim carries only what its own packages need,
# and the failure mode when it is missing is an image that builds cleanly and
# dies at the first query (research.md §1).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable

WORKDIR /app

# ---------------------------------------------------------------------------
# deps — the full workspace install.
#
# Manifests and the lockfile are copied BEFORE any source, so editing a source
# file never re-resolves dependencies (SC-004, data-model.md §1). The Prisma
# schema is copied here too, not later: the root package.json's `postinstall`
# runs `prisma generate`, which cannot run without it.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json                 apps/api/
COPY packages/persistence/package.json     packages/persistence/
COPY packages/config-eslint/package.json   packages/config-eslint/
COPY packages/config-prettier/package.json packages/config-prettier/
COPY packages/config-typescript/package.json packages/config-typescript/

# Prisma schema + migrations: an input to `postinstall`, and the entire payload
# of the `migrator` target below.
COPY packages/persistence/prisma/ packages/persistence/prisma/

# `corepack install` reads the pinned version from package.json's
# packageManager field, so pnpm's version has one source of truth, not two.
RUN corepack install
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# migrator — one-shot schema migration. TARGET.
#
# This stage exists because of a hard constraint, not a preference: `prisma`
# (the CLI) is a devDependency of @fp/persistence, while @prisma/client is a
# runtime dependency. FR-008 forbids dev dependencies in the runtime image, so
# migrations cannot be run from it (research.md §3).
#
# The upside of being forced here is real: the artifact that can alter the
# schema is a different artifact from the one that serves traffic, and the
# long-running API image holds no migration capability at all.
#
# Payload is inherited from `deps`: the Prisma CLI, schema.prisma and
# migrations/. No application source. No HTTP server.
# ---------------------------------------------------------------------------
FROM deps AS migrator

CMD ["pnpm", "--filter", "@fp/persistence", "exec", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# development — a contributor's machine, via Compose. TARGET.
#
# Source is NOT copied in: it arrives as a bind mount at runtime, so an edit
# never requires a rebuild. Dependency trees are container-owned named volumes
# (see docker-compose.yml) — the host's are built for the host's platform, and
# letting them in produces failures that read as application bugs
# (research.md §4).
#
# Runs as root, unlike `runtime`. FR-008 scopes the non-root requirement to the
# runtime target, and root avoids a class of uid-mismatch permission problems
# on bind-mounted source that has nothing to teach anyone.
#
# @fp/persistence is built first because apps/api resolves it through its
# `main` field (./dist/index.js), and a fresh clone has no dist.
# ---------------------------------------------------------------------------
FROM deps AS development

ENV NODE_ENV=development

# Preflight the configuration before starting the watcher, so invalid config
# exits the container instead of leaving `tsx watch` alive with the error
# buried in the logs — the same guard scripts/dev.ts applies to the host path.
CMD ["sh", "-c", "pnpm --filter @fp/persistence run build && pnpm --filter @fp/api exec tsx src/config/check-env.ts && pnpm --filter @fp/api run dev"]

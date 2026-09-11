# syntax=docker/dockerfile:1

# Mirrors apps/api/Dockerfile's stage structure (ADR-014). Build context is the
# REPOSITORY ROOT, same reason: the workspace lockfile and sibling packages
# are required. No `migrator` target — apps/api's owns migrations.
#
# Targets:
#   development  contributor's machine, via Compose. Source bind-mounted.
#   runtime      the deployable. No package manager, no source.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json                 apps/api/
COPY apps/worker/package.json              apps/worker/
COPY packages/persistence/package.json     packages/persistence/
COPY packages/kernel/package.json          packages/kernel/
COPY packages/core/package.json            packages/core/
COPY packages/contracts/package.json       packages/contracts/
COPY packages/platform/package.json        packages/platform/
COPY packages/config-eslint/package.json   packages/config-eslint/
COPY packages/config-prettier/package.json packages/config-prettier/
COPY packages/config-typescript/package.json packages/config-typescript/
COPY packages/testing/package.json          packages/testing/

COPY packages/persistence/prisma/ packages/persistence/prisma/

RUN corepack install
RUN pnpm install --frozen-lockfile

COPY packages/persistence/src/ packages/persistence/src/

# ---------------------------------------------------------------------------
# development — a contributor's machine, via Compose. TARGET.
# ---------------------------------------------------------------------------
FROM deps AS development

ENV NODE_ENV=development

CMD ["sh", "-c", "pnpm --filter @fp/persistence run build && pnpm --filter @fp/worker run dev"]

# ---------------------------------------------------------------------------
# build — compile, then prune to a self-contained production tree.
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

RUN pnpm exec turbo run build --filter=@fp/worker

RUN pnpm deploy --filter @fp/worker --prod --legacy /app/deploy

# ---------------------------------------------------------------------------
# runtime — the deployable. TARGET.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/deploy ./

RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /opt/yarn-v* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg

USER node

CMD ["node", "dist/main.js"]

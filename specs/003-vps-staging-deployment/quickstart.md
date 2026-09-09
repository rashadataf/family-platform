# Quickstart: Validating the VPS Staging Deployment

Run-and-verify guide for this feature. Not implementation instructions — see
[contracts/cli-and-config.md](contracts/cli-and-config.md) for the exact command surface and
[data-model.md](data-model.md) for the config schema referenced below.

## Prerequisites

- SSH access to the founder's existing VPS, with a private key set as the `vpsSshPrivateKey`
  Pulumi stack secret (see data-model.md's `StackConfig`).
- A Pulumi Cloud account with access to this project's state (ADR-004), and `pulumi login`
  completed locally, or `PULUMI_ACCESS_TOKEN` set when validating the CI path.
- Docker installed locally (or on the CI runner) to build the API image.
- The portfolio site's containers already running on the VPS, so isolation (User Story 3) can
  actually be exercised rather than assumed.

## Scenario 1 — First deploy reaches a working staging URL (User Story 1, P1)

1. From a clean state (`pulumi stack ls` shows no prior `vps-staging` update), run `pnpm staging:deploy`.
2. **Expect**: the command builds the API image, transfers it to the VPS, brings up `postgres` and `api` on the isolated `stagingNetworkName` network, applies every committed migration, seeds the fixture data set, and exits 0.
3. Request `http://<vpsHost>:<apiPublishedPort>/health/ready` (or the equivalent readiness route `apps/api` already exposes per spec 001).
4. **Expect**: a successful response, within the 30-minute bound of SC-001.
5. On the VPS, confirm via SSH (`docker network ls`, `docker ps`) that the running containers share no network, volume, or name with the portfolio site's containers (User Story 3, acceptance scenario 2).

## Scenario 2 — Redeploy preserves data; reset clears it (User Story 2, P2)

1. With staging already deployed, note some state (e.g., row count in the `ScaffoldProbe` table via a manual `psql` check over SSH, or any founder-added data).
2. Run `pnpm staging:deploy` again with no code changes.
3. **Expect**: exits 0, the staging URL stays reachable throughout, and the noted state is unchanged (SC-002).
4. Add a new (trivial, non-domain) migration file, then run `pnpm staging:deploy` again.
5. **Expect**: the new migration applies automatically, with no manual database command (SC-003).
6. Run `pnpm staging:deploy:reset`.
7. **Expect**: the database is wiped and reseeded from the fixture set only — the state noted in step 1 is gone (SC-002's reset-path guarantee).
8. Run `pnpm staging:destroy`.
9. **Expect**: every staging-specific container, network, and resource is removed from the VPS; a subsequent SSH check shows the portfolio site's containers still running, untouched (SC-004).

## Scenario 3 — CI deploys automatically on merge (User Story 1 + FR-019)

1. Open a pull request with a trivial change; confirm the `infra-preview` CI job runs and posts a `pulumi preview` result without altering the live environment.
2. Merge the pull request to `main`.
3. **Expect**: the `infra-deploy` CI job runs only after every other blocking check on `main` succeeds — `typecheck`, `lint`, `format`, `test`, `test-integration`, `verify-env`, `boundaries`, `security`, `build`, `image` (contracts/cli-and-config.md, corrected for spec 005) — and the staging URL serves the merged change afterward with no manual step (SC-008).
4. Confirm no CI job ever invokes `pnpm staging:destroy` or `pnpm staging:deploy:reset` (FR-020) — inspect `.github/workflows/ci.yml` directly.

## Scenario 4 — Reboot recovery (FR-017, SC-007)

1. With staging deployed, reboot the VPS (or, if that is too disruptive to rehearse against the shared portfolio site, restart just the Docker daemon: `sudo systemctl restart docker`).
2. **Expect**: `postgres` and `api` come back up on their own within a few minutes, with no `pnpm staging:deploy` invocation — confirms the `restart: unless-stopped` policy from `docker-compose.staging.yml` is actually in effect, not just declared.

## Scenario 5 — Documentation answers the purpose/data question unaided (SC-006)

1. Hand someone unfamiliar with this feature only the committed documentation (per FR-015, expected under `docs/`).
2. **Expect**: they can state, without asking anyone, what this environment is for and that it must never hold real user or family data.

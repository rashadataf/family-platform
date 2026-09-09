# Staging Environment

## What this is for

**Technical validation, demos, and the founder's own dogfooding — nothing else.**

This is Stage 0 of [ADR-013](../adr/ADR-013-staged-hosting-model.md): a single, shared deployment of this application on the founder's existing VPS, alongside an unrelated portfolio site the founder already runs there. It exists so the platform can be reached at a real URL, by someone other than whoever has the repository checked out, before any AWS infrastructure is justified.

It is not a beta. It is not a place to invite a real family, even one person the founder trusts completely, to try the product with their own data.

## The synthetic-data-only constraint

**This environment is never authorized to hold real user or family data — not a real name, not a real child's record, not a real passport scan, not even one, not even temporarily.**

This is not a technical claim; nothing here inspects what gets typed into a form and rejects it. It is a procedural one, backed by how the environment is built:

- The database starts empty and is populated only by [`packages/persistence/prisma/seed.ts`](../packages/persistence/prisma/seed.ts) — committed, synthetic fixture content, containing no field that resembles a real name, address, or document.
- There is no supported path for loading anything else. Nobody operating this deployment has a documented way to import real data into it, because none was built.
- Resetting the environment (`pnpm staging:deploy:reset`) wipes the database and reseeds it from that same fixture set — the environment's data is disposable by design, on purpose, so nobody is ever tempted to treat it as durable.

[Constitution Principle VI](../.specify/memory/constitution.md), *Children and Family Data Are Sensitive by Default*, is marked non-negotiable and is not relaxed here for cost or convenience. The trigger for moving to real data is defined in ADR-013: real personal data moves to the AWS topology (Stage 1), never to this VPS, regardless of whether revenue exists yet.

## What "reachable" means here

- The staging URL (`http://<vps-host>:<port>` — see [`contracts/cli-and-config.md`](../specs/003-vps-staging-deployment/contracts/cli-and-config.md) in spec 003) is openly reachable, with no authentication gate and no IP allowlist in front of it. That is accepted at this stage specifically because the environment holds only synthetic data — if it held anything else, this would be a problem, not a design choice.
- There is no dedicated logging or monitoring for this environment. Checking on it means SSHing into the VPS and using the Docker CLI directly — `docker compose ps`, `docker compose logs` — the same operating model already used for the portfolio site sharing that VPS.
- Its containers run on their own Docker network, isolated from the portfolio site's: no shared volume, no shared database, no shared secret. Standing it up or tearing it down never touches the portfolio site's containers.

## Operating it

See [`specs/003-vps-staging-deployment/contracts/cli-and-config.md`](../specs/003-vps-staging-deployment/contracts/cli-and-config.md) for the full command reference (`pnpm staging:preview` / `staging:deploy` / `staging:deploy:reset` / `staging:destroy`) and [`specs/003-vps-staging-deployment/quickstart.md`](../specs/003-vps-staging-deployment/quickstart.md) for step-by-step scenarios. In short:

- Merging to `main` deploys automatically via CI. Nobody needs to run a manual command for an ordinary change to reach staging.
- `pnpm staging:deploy` (ad hoc) and `pnpm staging:destroy` exist for the founder to run directly. Teardown is never triggered by CI or by a merge — it is a deliberate, manually-invoked action only.

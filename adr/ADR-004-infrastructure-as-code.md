# ADR-004: Infrastructure as Code with Pulumi

- **Status:** Amended by ADR-013
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

> **Scope of the amendment.** [ADR-013](ADR-013-staged-hosting-model.md) replaces the
> "The MVP infrastructure this provisions" section below, and only that section. Everything
> else in this ADR — Pulumi with TypeScript, one stack per environment sharing a single
> program, stack outputs as the source of truth for application configuration, deletion
> protection on stateful resources, and CI-gated production applies — **remains in full
> effect and is unamended**. This ADR is deliberately *not* marked `Superseded`, because
> its decision was not replaced; a reader who saw that status would wrongly conclude that
> Pulumi is no longer this project's IaC tool.

## Context

All infrastructure must be reproducible through code, across four environments (local, development, staging, production) plus optional per-pull-request preview environments. The blueprint names Pulumi, Terraform and AWS CDK, and discloses existing Pulumi experience.

Existing experience is a legitimate input for a solo founder and it is weighted as such, but it is not sufficient on its own. This ADR records the reasons that hold even if that experience is set aside, so the decision survives a future team that does not share it.

Requirements that should decide it:

1. **Four environments differing mostly in size, not in shape.** Production is multi-AZ with larger instances; development is single-AZ and small. The same topology, parameterised.
2. **Ephemeral preview environments.** Creating and destroying a full stack per pull request must be a loop, not a copied directory.
3. **Non-AWS resources are already in scope.** Sentry projects, feature-flag configuration, Expo/EAS settings, a DNS provider, and later Stripe or RevenueCat webhooks. Infrastructure is not purely AWS even at MVP.
4. **One developer maintains it alongside application code.** Context-switching cost is a real cost.
5. **Some infrastructure values are application values.** Queue URLs, bucket names, KMS key ARNs and secret ARNs must reach the application as typed configuration without hand-copying.
6. **Blast radius must be controllable.** A mistake here deletes a database.

## Decision

**Pulumi with TypeScript, in `infrastructure/` as a workspace package, with state in Pulumi Cloud.**

Supporting choices:

- One stack per environment, sharing a single program with configuration-driven sizing.
- Stack outputs are the single source of truth for application configuration, consumed by the ECS task definitions rather than transcribed into a settings file.
- Deletion protection on RDS, S3 and KMS in production, plus `pulumi.protect` on stateful resources.
- All production applies run in CI with a mandatory `pulumi preview` posted to the pull request and a manual approval gate. Local applies against production are not permitted.
- Component abstractions are written only on the third repetition. No `ComponentResource` before then.

## Alternatives considered

### Terraform / OpenTofu — the strongest alternative, rejected

Terraform's advantages are real and should be stated plainly, because this is the closest call in the set.

- The largest provider and module ecosystem in existence. Well-maintained community modules exist for a VPC, an ECS service and an RDS instance.
- HCL is declarative and constrained, which makes infrastructure code hard to make clever, which is usually a virtue.
- The largest hiring pool and the most operational knowledge in the industry. Almost any DevOps engineer can read it.
- `terraform plan` output is the industry reference for reviewable change.

Reasons it is still rejected here:

**HCL's expressiveness fails at exactly requirement 2.** Preview environments per pull request mean dynamically creating a stack, wiring it to a shared VPC, seeding a database and tearing it down. In TypeScript that is a function taking a branch name. In HCL it is workspaces plus `count` and `for_each` plus `dynamic` blocks plus templating, and the result is code that is genuinely harder to read than the imperative equivalent. HCL's constraints are a benefit when infrastructure is static and a tax when it is parameterised, and ours is parameterised across five-ish environments.

**Two languages and two toolchains for one developer.** Requirement 4 is not a soft preference. With Pulumi, the same TypeScript, the same `pnpm`, the same ESLint config, the same test runner and the same editor tooling cover the application and the infrastructure. Environment names, resource-tag schemas and configuration shapes can be typed once in `packages/kernel` and imported by both. That eliminates a class of drift where the infrastructure says `staging` and the application says `stage`.

**Requirement 5 is materially better served.** Pulumi stack outputs are typed values in TypeScript. `apiTaskDefinition` can reference `documentBucket.arn` directly and get a compile error if it is misspelled. Terraform's equivalent is a remote state data source and stringly-typed outputs.

**Type checking catches a real class of error before `plan`.** Passing a security group where a subnet is expected is a compile error in Pulumi and a plan-time or apply-time error in Terraform.

Terraform's ecosystem advantage is smaller than it appears for this footprint, because the infrastructure is roughly a dozen resource types that are well documented in Pulumi's AWS provider, which is generated from the same upstream schema as Terraform's.

**If this decision is ever reversed, OpenTofu rather than Terraform is the target**, given the licence change.

### AWS CDK — rejected

CDK also offers TypeScript, so it addresses requirements 4 and 5. It is rejected on the execution engine and on scope.

**CloudFormation is the deciding problem.** CDK synthesises to CloudFormation, and CloudFormation's failure modes are inherited whole: stacks stuck in `UPDATE_ROLLBACK_FAILED` requiring console intervention, slow rollbacks measured in tens of minutes, resource limits per stack, and drift handling that is aware of drift but poor at reconciling it. For a solo operator, a stack wedged in a rollback state at an inconvenient hour is a materially worse day than a failed `pulumi up` that can be re-run.

**Requirement 3 rules it out on its own.** Sentry, the DNS provider, feature flags and later billing webhooks are not AWS resources. CDK is AWS-only by construction. CDK for Terraform exists but stacks a second abstraction on top of a first, which is worse than either alone.

**Constructs hide IAM.** L2 and L3 constructs generate IAM policies through helpers like `grantRead`. That is convenient and it is the wrong trade for an application storing families' passports and children's records. The security model in [ARCHITECTURE.md §9](../ARCHITECTURE.md) requires that least-privilege policies are explicit, reviewable artefacts. Generated policies are routinely broader than intended and nobody reads the synthesised template.

CDK's genuine strength, high-level constructs that produce a lot of correct infrastructure from little code, is most valuable to teams who want to avoid learning AWS primitives. That is not the situation here, and the abstraction cost is paid at exactly the moments that matter most.

### Serverless Framework / SST — rejected

Both are strong for Lambda-centric applications. [ADR-002](ADR-002-modular-monolith.md) rejects Lambda for the API, which removes most of their value, and both are narrower in scope than the full infrastructure this needs.

### ClickOps with documentation — rejected

Non-reproducible, undiffable, unreviewable, and it makes preview environments impossible. Explicitly contrary to a stated constraint.

## The MVP infrastructure this provisions

Deliberately small. Growth is planned in the scalability roadmap, not provisioned in advance.

| Resource | Present at MVP | Notes |
|---|---|---|
| VPC, 2 AZs, public + private subnets | Yes | One NAT gateway in non-production, two in production |
| ALB + AWS WAF | Yes | Managed rule sets plus rate limiting |
| ECS Fargate, API service | Yes | 2 tasks minimum for rolling deploys |
| ECS Fargate, worker service | Yes | 1 task, autoscaled on queue depth |
| RDS PostgreSQL | Yes | Single-AZ in dev, Multi-AZ in production, PITR enabled |
| S3 document bucket | Yes | SSE-KMS, versioning, block all public access, lifecycle rules |
| SQS queues + DLQs | Yes | Per logical consumer, each with a DLQ |
| KMS keys | Yes | Separate keys for documents and for secrets |
| Secrets Manager | Yes | Rotation configured for the database credential |
| ECR | Yes | Immutable tags, image scanning on push |
| Route53 + ACM | Yes | |
| CloudWatch logs, metrics, alarms | Yes | Structured JSON logs, retention set per environment |
| CloudFront | No | See [ARCHITECTURE.md §4](../ARCHITECTURE.md) |
| ElastiCache | No | Deferred to the 100k-user tier |
| EventBridge | No | See [ADR-005](ADR-005-event-system.md) |

## Consequences

### Positive

- One language and one toolchain across application and infrastructure.
- Preview environments are an ordinary function call over a branch name.
- Infrastructure values reach the application as typed stack outputs, removing a drift class entirely.
- Infrastructure can be unit tested with Pulumi's mocks, so assertions like "the document bucket denies public access" and "the API task role cannot read the secrets key" run in CI as tests.
- Provider coverage extends beyond AWS as requirement 3 demands.

### Negative

- **A general-purpose language permits bad abstractions.** Pulumi programs can become unreadable in ways HCL prevents. Mitigation: the rule that no `ComponentResource` is written before the third repetition, plus a hard limit that the infrastructure package depends only on `packages/kernel` and never on application packages.
- **Smaller ecosystem and community than Terraform.** Fewer copy-paste answers. Mitigation: the AWS provider is generated from the same schema, so Terraform documentation usually translates directly.
- **State backend is a dependency.** Pulumi Cloud is free for individual use and its managed state, locking and history are worth having, but it is a third party in the deployment path. Mitigation: state is exportable, and the self-managed S3 backend is a documented fallback. Migrating is `pulumi stack export` and `import`.
- **Hiring pool is narrower.** Real but secondary, and TypeScript familiarity transfers most of the way.
- **Blast radius is real regardless of tool.** Mitigation: deletion protection, `pulumi.protect` on stateful resources, mandatory preview in the pull request, manual approval for production, and no local applies to production.

### Revisit this decision when

- A platform team forms whose existing expertise is Terraform, or
- Pulumi Cloud pricing or availability becomes a problem at team scale, at which point the S3 backend is evaluated, or
- Infrastructure grows beyond roughly 150 resources, where module ecosystems start to pay for themselves.

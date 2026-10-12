# ADR-033: Infrastructure portability seams

| | |
|---|---|
| **Status** | Accepted as the target shape (stakeholder decision 2026-10-13); implemented incrementally, when a second provider is actually needed |
| **Deciders** | Khai Pham (stakeholder); design drafted with Claude Opus 5.5 |
| **Builds on** | ADR-003 (PostgreSQL concurrency), ADR-016 (reflection budget), ADR-027 (Access identity), ADR-028 (Clef triage), ADR-032 (deferred customer requests and the deadline port) |

## Context

The stakeholder asked that infrastructure be abstracted so the hosting provider can change without rewriting the application. An inventory on 2026-10-13 shows most of the stack is already portable, and the vendor-specific parts are few and narrow.

| Concern | Today | Vendor-specific? |
|---|---|---|
| Database | PostgreSQL 17 through EF Core and Npgsql | No: managed PostgreSQL exists on every major cloud and on premises. ADR-003 deliberately depends on PostgreSQL features (exclusion constraints, advisory locks), and that coupling stays |
| Telemetry | OpenTelemetry over OTLP; Grafana dashboards and alerts validated offline | No: any OTLP backend works |
| Containers and local orchestration | OCI images; .NET Aspire for local runs | No |
| Email | `IEmailSender` port with SMTP and disabled adapters; a Cloudflare relay provider is reserved but not implemented | Port already exists |
| Booking intake triage | `CloudflareTriageClient`: Clef-flash on Workers AI through AI Gateway, closed-choice questions with calibrated probabilities | Yes |
| Triage photos | `TriageImageStore`: HTTP to a private relay in front of R2 | Yes (transport is plain HTTP; storage is R2) |
| Identity | `AccessTokenValidator` and `AccessSigningKeys` validate Cloudflare Access JWTs; `RoleClaimsTransformation` maps emails to roles from configuration | Yes (validation is standard JWT; issuer discovery and headers are Access-specific) |
| Edge | `deploy/cloudflare` Worker: static assets, routing, OTLP and photo relays, container hosting | Yes (a deployment concern, not application code) |
| Durable deadlines | Not built (ADR-032) | Would be pluggable from the start |

## Decision

1. **Ports for the vendor-specific concerns only.** Each gets a small interface owned by the application, named for what the application needs, not for a vendor: triage evaluation (closed-choice questions with probabilities), object storage for transient photos, email (exists), token validation and role mapping, and durable deadlines (ADR-032).
2. **Adapters per vendor in their own project.** Cloudflare adapters (Clef triage, the photo relay, Access token validation, the email relay when built) move to `Keyloop.ServiceScheduler.Infrastructure.Cloudflare`; vendor-neutral adapters (PostgreSQL, SMTP, OTLP, a PostgreSQL deadline poller) stay in `Keyloop.ServiceScheduler.Infrastructure`. The API selects adapters by configuration at startup, as `Notifications:Provider` already does.
3. **An architecture test** fails if the core, the domain or the API slices reference a vendor project or vendor SDK namespace directly.
4. **Second adapters only where they are cheap and standard.** S3-compatible object storage (works with R2, Amazon S3 and MinIO), generic OIDC JWT validation (Cloudflare Access, Microsoft Entra ID, Amazon Cognito) and the PostgreSQL deadline poller. A second triage provider is not planned: Clef's calibrated closed-choice probabilities have no drop-in equivalent, so another model would need its own adapter and a fresh golden-set calibration before use.
5. **PostgreSQL is not abstracted.** Hiding it behind a generic repository would remove the database-enforced double-booking guarantee (ADR-003); portability comes from PostgreSQL being available everywhere.

## Consequences

- Moving to another cloud means writing or selecting adapters for at most four ports and a new edge or ingress profile; domain, slices, persistence and telemetry stay unchanged.
- Each adapter needs contract tests shared across its implementations (the same suite runs against every adapter of a port).
- Work is done when a second provider is needed, not up front; this ADR records the target so the seams are not eroded in the meantime (new vendor code goes behind a port).

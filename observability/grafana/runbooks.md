# Scheduler alert runbooks

Publish this reviewed file at an HTTPS URL before preparing alert rules. The preparation command appends the anchors below. These procedures describe investigation; any deployment, database write, notification resend, or configuration change belongs to its separately approved operational task.

## Booking deadlocks

Expected: no booking deadlocks. The rule checks the last 10 minutes, without a pending period. PostgreSQL `40P01` appears in log event `1004 DeadlockDetected` and the Booking engine dashboard's first panel.

Inspect the failing booking trace and recent code changes against SYSTEM_DESIGN section 7.3 and ADR-003: one dealership advisory lock, no second contended operation, and `READ COMMITTED`. Find the transactions and lock order involved. Preserve the PostgreSQL exclusion constraints and the adversarial concurrency proof. An idempotency-key operation is the documented scoped exception; an outbox insert must remain uncontended on the booking path. Capture the trace id and constraint-free lock evidence for the owner of the faulty code.

`increase()` needs at least two samples. An event before the first export or a short-lived process can escape this rule; inspect event 1004 directly as well. A displayed zero from `or vector(0)` is compatible with absent telemetry.

## Constraint backstop

Expected: no exclusion backstop under the locked booking path. The rule checks the last 10 minutes, with one alert instance per `constraint` when present. Inspect log event `1003 ConstraintBackstopFired` and the Booking engine dashboard's constraint breakdown.

Use the constraint name to distinguish bay overlap from technician overlap. Identify scripts, administrative writes, or other writers that bypassed the dealership advisory lock, then inspect the booking's locked pre-check and insert trace. The exclusion constraint prevented double booking; keep it intact. Expected contention returns `slot_unavailable` before insert and should not increment this counter. Preserve the trace and writer identity for investigation. The first-export caveat in Booking deadlocks applies here too.

## API 5xx

Trigger: 5xx ratio above 0.001, using a 10-minute rate window, continuously for 5 minutes. `/health` and `/alive` are excluded. A ratio without traffic is undefined and does not establish service health.

Open API health and compare errors by route/status with log event `1200 UnhandledException`. Follow the trace id through the API and SQL. Check database connectivity, migration state, pool pressure, and failed commits. Expected `409` contention, `422` domain rules, and `429` limits do not count as 5xx. A booking may have committed despite a lost acknowledgement; verify its idempotency/commit evidence before any later replay or remediation.

## Booking latency

Trigger: booking p95 above 300 ms and throughput above 0.02 bookings/second in a 5-minute window, continuously for 5 minutes. The traffic gate is roughly six bookings per window. The dashboard also shows the 150 ms SLO.

Compare booking latency by outcome with lock wait p95, hottest dealerships, and availability duration. Inspect one representative slow trace down to the SQL command. Expected stress traffic intentionally queues on a dealership lock; distinguish that from a slow database or a new transaction operation. Current histogram defaults interpolate across the SLO/page thresholds until G1 provides suitable boundaries, so preserve raw trace durations as corroborating evidence.

## Outbox age

Trigger: oldest Pending row older than 300 seconds, continuously for 10 minutes. This is the G2 ObservableGauge `scheduler.notifications.oldest_pending_age` in seconds, not the age-at-send histogram. The gauge is absent from Task 19 code at authoring time. Missing data is `Ok` for evaluation but is a release acceptance failure until the gauge has been verified.

Open Notifications. Check pending depth, oldest age, sends, retries, and dead letters by kind. Confirm the dispatcher and provider configuration, which default to disabled/None in Production until the adapter and operational configuration are approved. Rows are enqueued even when sending is disabled. Inspect notification events `1202` (retry), `1203` (terminal failure), `1204` (cycle failure), and `1205` (claim lost). These ids reflect the unmerged Task 19 code and require verification on integration.

Verify the backlog observer refreshes when dispatch is off, includes delayed retries and leased Pending rows, and reports zero for an empty queue. A failed observation must not publish a fabricated healthy zero. Compare database-wide gauge values across API instances: summing identical snapshots duplicates depth, so use a single observer or revise the aggregation after topology is known. At-least-once delivery means an uncertain provider acknowledgement can already represent a sent message. Do not blindly resend or clear claims; retain the outbox id as the correlation reference for a separately approved recovery.

## Readiness

Trigger: a reported non-2xx response from `/health` or `/alive` during the last 5 minutes. It evaluates each minute without a pending period. This is evidence of an observed failed poll. It cannot detect a completely down process, a lost exporter, or an unpolled endpoint. Missing OTLP is expected while the demo container sleeps; no absence-based outage rule is defined.

Open API health and inspect responses by health route/status. `/health` checks database connectivity and applied migrations; `/alive` checks process liveness. Check startup log events `1103`/`1104`, database health, and ingress readiness behavior. A `429` also fails the observed poll, so check rate limiting and whether health polling is unexpectedly exposed through a shared limit. A real uptime requirement needs the separately approved Synthetic Monitoring check; regular probes wake the container and affect cost. Never reinterpret `target_info` or an invented OTLP `up` series as an external readiness probe.

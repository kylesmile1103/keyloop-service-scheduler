# Scheduler alert runbooks

Publish this reviewed file at an HTTPS URL before preparing alert rules. The preparation command appends the anchors below. These procedures describe investigation; any deployment, database write, notification resend or configuration change belongs to its separately approved operational task.

## Booking deadlocks

Expected: no booking deadlocks. The rule checks the last 10 minutes, without a pending period. PostgreSQL `40P01` appears in log event `1004 DeadlockDetected` and the Booking engine dashboard's first panel.

Investigation:

- Inspect the failing booking trace and recent code changes against ARCHITECTURE section 7.3 and ADR-003: one dealership advisory lock, no second contended operation, and `READ COMMITTED`.
- Find the transactions and lock order involved. An idempotency-key operation is the documented scoped exception; an outbox insert must remain uncontended on the booking path.
- Preserve the PostgreSQL exclusion constraints and the adversarial concurrency proof.
- Capture the trace id and the lock evidence for the owner of the faulty code.

How the rule counts:

- OTel creates the counter series on its first deadlock, so that series' first exported sample is already 1. The rule adds the value of any series first seen in the window to `increase()` over the others, so the first deadlock of a process fires it.
- Two gaps remain: a process that dies before its first export, and a restart that reuses the same `instance` label within about 15 minutes of the previous process's last export while that process had already counted a deadlock. Either can delay or miss the alert. On Cloudflare every restart of the container reuses the same (empty) instance label.
- Conversely, an export gap longer than 5 minutes in a process that has already counted a deadlock makes the old count look new and fires the rule again, so compare the time of event 1004 with the alert, and inspect event 1004 directly as well.
- A displayed zero from `or vector(0)` is compatible with absent telemetry.
- Recording `Add(0)` for the counter when the process starts would close the restart gap; that is an API code change.

## Constraint backstop

Expected: no exclusion backstop under the locked booking path. The rule checks the last 10 minutes, with one alert instance per `constraint` when present. Inspect log event `1003 ConstraintBackstopFired` and the Booking engine dashboard's constraint breakdown.

Investigation:

- Use the constraint name to tell bay overlap from technician overlap.
- Identify scripts, administrative writes or other writers that bypassed the dealership advisory lock, then inspect the booking's locked pre-check and insert trace.
- The exclusion constraint prevented the double booking; keep it intact. Expected contention returns `slot_unavailable` before the insert and does not increment this counter.
- Preserve the trace and the writer's identity for investigation.

The first-export handling and its two gaps described under Booking deadlocks apply here too, per constraint.

## API 5xx

Trigger: 5xx ratio above 0.001, using a 10-minute rate window, continuously for 5 minutes. `/health` and `/alive` are excluded. A ratio without traffic is undefined and does not establish service health.

Investigation:

- Open API health and compare errors by route and status with log event `1200 UnhandledException`. Follow the trace id through the API and SQL.
- Check database connectivity, migration state, pool pressure and failed commits.
- Expected `409` contention, `422` domain rules and `429` limits do not count as 5xx.
- A booking may have committed despite a lost acknowledgement; verify its idempotency and commit evidence before any later replay or remediation.

## Booking latency

Trigger: booking p95 above 300 ms and throughput above 0.02 bookings/second in a 5-minute window, continuously for 5 minutes. The traffic gate is roughly six bookings per window. The dashboard also shows the 150 ms SLO.

Investigation:

- Compare booking latency by outcome with lock wait p95, the hottest dealerships and availability duration.
- Inspect one representative slow trace down to the SQL command.
- Expected stress traffic deliberately queues on a dealership lock; distinguish that from a slow database or a new transaction operation.
- The histogram's default buckets interpolate across the SLO and page thresholds until the bucket boundaries are tuned, so preserve raw trace durations as corroborating evidence.

## Outbox age

Trigger: oldest Pending row older than 300 seconds, continuously for 10 minutes. This is the ObservableGauge `scheduler.notifications.oldest_pending_age` in seconds, declared in Infrastructure `InfrastructureTelemetry.cs`, not the age-at-send histogram. Missing data is `Ok` for evaluation but is a release acceptance failure until the gauge has been verified.

Investigation:

- Open Notifications. Check pending depth, oldest age, sends, retries and dead letters by kind.
- Confirm the dispatcher and provider configuration, which default to disabled and `None` in Production until the adapter and operational configuration are approved. Rows are enqueued even when sending is disabled.
- Inspect notification events `1301 NotificationRetried`, `1302 NotificationFailed` (terminal failure), `1303 NotificationDispatchCycleFailed` and `1304 NotificationClaimLost` (Infrastructure `InfrastructureLog`, ARCHITECTURE section 12.1).
- Verify the backlog observer refreshes when dispatch is off, includes delayed retries and leased Pending rows, and reports zero for an empty queue. A failed observation must not publish a fabricated healthy zero.
- Compare database-wide gauge values across API instances: summing identical snapshots duplicates depth, so use a single observer or revise the aggregation once the topology is known.
- At-least-once delivery means an uncertain provider acknowledgement can already represent a sent message. Do not blindly resend or clear claims; keep the outbox id as the correlation reference for a separately approved recovery.

## Notification dead letters

Expected: no dead letters. The rule checks the last 15 minutes per `kind`, without a pending period, and counts a kind's first exported sample like Booking deadlocks. Severity is ticket: a customer did not receive a confirmation or cancellation email, which is not an outage.

Investigation:

- Open Notifications and inspect event `1302 NotificationFailed` (terminal failure) with its outbox id and kind.
- Check the sender configuration, the provider's response category and the recipient policy. A suppressed reserved-domain recipient is `scheduler.notifications.suppressed`, not a dead letter.
- At-least-once delivery means a lost provider acknowledgement can already represent a sent message: do not resend blindly. Any resend is a separately approved recovery that keeps the outbox id as its correlation reference.

## Readiness

Trigger: a reported non-2xx response from `/health` or `/alive` during the last 5 minutes, evaluated each minute without a pending period. This is evidence of an observed failed poll. It cannot detect a completely down process, a lost exporter or an unpolled endpoint. Missing OTLP is expected while the demo container sleeps; no absence-based outage rule is defined.

On Cloudflare (edge code under `deploy/cloudflare`), the Worker answers public `/health` and `/alive` from static assets, and the Durable Object only pings `localhost/alive` while the container starts.
Nothing calls `/health` on the container, and `/alive` does not touch the database, so this rule covers failed start pings only.
Pointing the Durable Object ping at `/health`, or adding another in-network poller, makes it a database readiness signal; that is a separate edge change.

Investigation:

- Open API health and inspect responses by health route and status. `/health` checks database connectivity and applied migrations; `/alive` checks process liveness.
- Check startup log events `1103`/`1104`, database health and ingress readiness behaviour.
- A `429` also fails the observed poll, so check rate limiting and whether health polling is unexpectedly exposed through a shared limit.
- A real uptime requirement needs the separately approved Synthetic Monitoring check; regular probes wake the container and affect cost.
- Never reinterpret `target_info` or an invented OTLP `up` series as an external readiness probe.

## Allocation below HV minimum

`scheduler.allocation.below_hv_minimum` must stay zero. The must-be-zero alert detects the first exported increment, including a process's first event.

Investigation:

- Open the Booking engine panel *HV allocations below minimum, must be 0*, then Critical event 1020. It carries the appointment and technician ids, the dealership-local date the expiry was judged on, the policy version, the ordered fired rules and the required and effective levels (ids and codes only, never a name).
- Compare the technician's level and inclusive expiry with that date and the policy version's rules.
- The appointment id never commits (the aggregate refuses the allocation), so search by technician id and date.
- Stop affected booking traffic and correct the hard filter before resuming. Never lower the resolved minimum to clear the alert. Aggregate reassertion independently refuses the invalid allocation.

The first-export and stale-series limitations documented for Booking deadlocks apply.

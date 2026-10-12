# ADR-032: Customer booking requests with slot holds and durable deadlines

| | |
|---|---|
| **Status** | Proposed, deferred (stakeholder decision 2026-10-13: design recorded, not built) |
| **Deciders** | Khai Pham (stakeholder); design drafted with Claude Opus 5.5 |
| **Builds on** | ADR-002 (Appointment aggregate), ADR-003 (lock + exclusion constraints), ADR-027 (Access identity and roles), ADR-029 (vehicle-aware allocation), ADR-033 (portability seams) |
| **Would touch** | Domain lifecycle, availability and booking slices, the exclusion constraints' predicate, notifications, the board, Calendar and Overview, a new public request surface |

## Context

Today only staff book, and a booking is confirmed at once (ARCHITECTURE section 5.5). The customer channel is listed as "Online booking portal (future; same API)" in section 2.1. In a brainstorm on 2026-10-13 the stakeholder asked for a customer self-booking workflow: a customer requests a slot, the dealership confirms, declines or proposes another time, the customer can withdraw, the assigned technician acknowledges, and everyone can see where the request stands. The same brainstorm asked whether the workflow engine could be swapped between Cloudflare Workflows, Azure Durable Task and AWS Step Functions.

The stakeholder's answers: the purpose is customer self-booking; a request holds the chosen slot and expires if nobody answers; customers have no account and follow the request through a private link with abuse limits; all four steps (confirm or decline, propose another time, withdraw, technician acknowledgement) belong in a first version; the workflow is our own state machine with a pluggable clock (option 1 below); infrastructure gets ports and per-vendor projects (ADR-033).

## Proposed design

### State machine

The request is the appointment itself, so a hold is a real row under the double-booking constraints.

| From | Action (who) | To | Slot |
|---|---|---|---|
| none | Request a slot (customer, public) | Requested | held; a deadline starts (for example 4 hours, always before the slot) |
| Requested | Confirm (ServiceAdvisor or Admin) | Confirmed | kept; deadline cancelled |
| Requested | Decline with reason (ServiceAdvisor or Admin) | Declined | released |
| Requested | Propose another slot (ServiceAdvisor or Admin) | Proposed | old released, new held, a new deadline for the customer |
| Proposed | Accept (customer link) | Confirmed | kept |
| Proposed | Reject (customer link) | Declined | released |
| Requested or Proposed | Withdraw (customer link) | Withdrawn | released |
| Requested or Proposed | Deadline passes (clock) | Expired | released; customer told |
| Confirmed | Acknowledge (assigned technician) | Confirmed | an acknowledgement event, not a state |

After Confirmed the existing lifecycle continues (CheckedIn, InProgress, Completed, Cancelled, NoShow). Staff bookings from the board stay instant.

### Keeping holds safe

- Requested and Proposed are active statuses, so the partial `WHERE` of both exclusion constraints changes. This is a deliberate amendment of ADR-003; the 30-way contention proof gains rounds where holds compete with instant bookings and with each other.
- Races (confirm against expiry, withdraw against confirm, two advisors acting) use the existing `xmin` concurrency token: exactly one transition wins, a losing request gets `409 concurrency-conflict`, a losing deadline does nothing.
- Proposing another slot reuses the booking path under the dealership advisory lock and moves the same row, so no second contended insert is added.

### Customer surface and abuse limits

- No customer account. On submit the customer receives an unguessable token (at least 128 bits, stored hashed). The status link carries it in the URL fragment, so it never reaches server or edge logs; the page sends it in a request body.
- Limits: a bot check on submit, at most one or two pending holds per email and per client IP, a short hold time, and the existing per-IP booking rate limit.
- Notifications (received, confirmed, declined, proposed, expired) go through the existing outbox; on the public demo, sending stays off unless the stakeholder enables it.

### Durable deadlines (the only place an engine is needed)

A narrow port, for example `IDeadlineScheduler.Schedule(appointmentId, kind, dueUtc)` and `Cancel(...)`, with an application handler that applies the Expired transition.

- The deadline row is written in the same transaction as the transition (outbox style), so scheduling is atomic with the state change.
- Default adapter: PostgreSQL only. A `workflow_deadlines` table polled by a background worker with `FOR UPDATE SKIP LOCKED`, the pattern `NotificationDispatcher` already uses.
- Optional adapters relay the deadline to an engine and receive a callback: Cloudflare Workflows (`step.sleepUntil` in the edge Worker, then a call to the API), Azure Durable Task (an orchestration timer, then an activity call), AWS Step Functions (a `Wait` state with a timestamp, then an HTTP task).
- The handler re-reads the appointment and is idempotent, so a duplicate, late or uncancelled callback is harmless. Correctness never depends on the engine; the engine is an availability and scale choice.

### Visibility

A request inbox for staff with a countdown, held slots drawn as pending on the board and Calendar, a "my jobs" list with Acknowledge for technicians (needs the technician-to-email link from Task 30), and a status timeline drawn from the state machine definition plus `appointment_history`, masked for the customer view.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| A portable engine owns the flow (Dapr Workflow or Durable Task orchestrations waiting for external events) | Two sources of truth (engine history and the appointment row), a sidecar or backend to operate, and harder testing of the hold and double-booking interaction. Worth revisiting if long sagas with external systems appear. |
| One workflow definition across Cloudflare, Azure and AWS | Cloudflare Workflows is TypeScript code in Workers, Durable Task is .NET code, Step Functions is JSON definitions: a common definition means our own workflow language plus three compilers or drivers. The narrow deadline port gets the portability that matters at a fraction of the cost. |
| No hold, a wish only | No conflict risk and no timer, but the customer's chosen time can disappear before anyone answers. |
| Hold and auto-confirm on timeout | Commits the dealership without anyone looking. |
| Verify email before holding | Strongest against fake holds, but needs live email and adds a step. |
| Customer sign-in | Customer identity management is a non-goal (section 2.3). |

## Why deferred

- It changes the core guarantee: the exclusion constraints' predicate, the meaning of "available", and every read that shows appointments (board, Calendar, Overview KPIs, availability, masking, notifications, triage booking) would need updating and re-proving.
- It opens an abuse surface on the public demo (anonymous holds), with security review rounds of its own.
- Estimated size: about Tasks 27b, 28b and 31a combined.
- The brief centres on confirmed, conflict-free booking under contention; depth and correctness of that core weigh more than an additional flow.

## Revisit when

A real online customer channel is planned; Task 30's technician-to-email link exists; or another feature needs durable timers (reminders, automatic no-show marking), which would justify the deadline port on its own.

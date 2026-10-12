# Unified Service Scheduler video walkthrough

Target length: **10 minutes**. Rehearse the live sequence before recording and keep
the browser, Aspire dashboard, editor and terminal ready to switch between.
Commands below run from the repository root unless a subshell changes directory.
The UI and AppHost steps require the completed Tasks 14b–17; verify the labels and
resource links against the integrated branch before recording.

## Pre-flight checklist

- [ ] Docker is available. On macOS, run `colima status`; if stopped, run
  `colima start --cpu 4 --memory 6 --disk 40`. Confirm `docker info` succeeds.
- [ ] Restore, build and install the frontend before recording:

  ```bash
  dotnet restore
  dotnet build -c Release -warnaserror --no-restore
  (cd src/Keyloop.ServiceScheduler.Web && pnpm install --frozen-lockfile && pnpm generate:api)
  git diff --exit-code contracts/ src/Keyloop.ServiceScheduler.Web/src/api
  ```

- [ ] Start the AppHost in a dedicated terminal and leave it running:

  ```bash
  dotnet run --project src/Keyloop.ServiceScheduler.AppHost
  ```

  Open the dashboard URL printed by the AppHost, including its login token.
  Wait for `postgres`, `schedulerdb`, `api` and `web` to be ready and for `/health`
  to pass. Open the `web` resource's HTTP endpoint, then `/dispatch`; use the
  dashboard's resource links rather than assuming fixed ports.
- [ ] In **Resources → api → Commands**, click **Reseed demo data**, confirm the
  command succeeds, then refresh the board. This command deletes demo bookings;
  use the demo environment. Do not copy dashboard tokens or reseed keys into
  slides, source files or the recording.
- [ ] Select **Keyloop Motors Reading** and today's date in `Europe/London`.
  Confirm today's seeded appointments are visible. Record during workshop hours:
  seeding skips past slots and closed days. If there is no remaining bookable
  time today, use the next open day and explain the date change.
- [ ] Reserve three distinct future, free **EV Battery Health Check** slots for
  the conflict, suggested-slot recovery and stress demonstrations. Reading has
  one EV bay and one high-voltage technician, so each chosen slot has capacity
  one. Avoid the seeded EV booking and overlapping 60-minute appointments.
- [ ] Open two board tabs (**A** and **B**), one dashboard tab on **Traces**, one
  on **Metrics**, and the sidebar **API reference** link at `/scalar/v1`.
  Open DevTools **Network**, enable **Preserve log**, and filter `appointments`.
- [ ] Rehearse the adversarial test and leave its successful output in a second
  terminal. Run it once before recording to warm the PostgreSQL image and build:

  ```bash
  dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release \
    --filter "FullyQualifiedName~Concurrency"
  ```

  The contention test must retain its five rounds of 30 callers, exactly one
  `201` and 29 `409` per round, no `5xx`, no double bookings, no orphan audit or
  idempotency rows, and no deadlocks. Use the observed test result and duration.
- [ ] Increase editor/terminal font size, hide unrelated browser tabs, and close
  panels showing customer details or secret configuration. Keep the original
  booking's time and assigned bay/technician in your rehearsal notes.

## Recording sequence

| Time | Segment | Screen and purpose |
|---|---|---|
| 0:00–0:45 | Scenario | Dispatch board: one appointment needs a capable bay and a certified technician for its entire duration. |
| 0:45–2:45 | Architecture | C4 containers, vertical slices, PostgreSQL invariant, generated contract and Aspire. |
| 2:45–4:45 | Implementation | Exclusion constraints, transaction ordering, availability and problem responses. |
| 4:45–7:15 | Live demo | Booking, conflict recovery, cancel and rebook, 30-way stress, telemetry and Scalar. |
| 7:15–8:00 | Adversarial proof | Run the concurrency tests and show their real results. |
| 8:00–9:30 | AI collaboration | Design record, written plan, reviewed changes and defects caught. |
| 9:30–10:00 | Lessons | State the main trade-offs and remaining reflection budget. |

### 0:00–0:45 - Scenario and dispatch board

Click **Workshop → Dispatch Board**, select **Keyloop Motors Reading**, and point
to the date, KPI strip, bay lanes and status legend. Click **Technicians**, then
**Bays**. Explain that both resources must be free and qualified for the full
half-open interval; availability is a snapshot, so booking must check again.

### 0:45–2:45 - Architecture

Open [ARCHITECTURE.md §8.2](ARCHITECTURE.md#82-c4--containers-with-aspire-orchestration)
in a rendered Markdown preview. Follow browser → Vite proxy → API → PostgreSQL;
point to Aspire and its dashboard. Show the vertical-slice tree and generated
contract with these commands:

```bash
ls src/Keyloop.ServiceScheduler.Api/Features
ls src/Keyloop.ServiceScheduler.Api/Features/Appointments/BookAppointment
ls contracts/openapi src/Keyloop.ServiceScheduler.Web/src/api
```

Open `EndpointRegistry.cs`, `SchedulerJsonContext.cs` and `openapi-ts.config.ts`.
Explain explicit endpoint/DI registration, generated request delegates and JSON,
and HeyAPI-generated types, SDK calls and TanStack Query options. Show CI's
`git diff --exit-code` gates for the OpenAPI contract and generated client.

### 2:45–4:45 - Implementation highlights

Use editor **Go to File** to open, in order. The files span the three API
assemblies (ADR-025): pure Domain, Infrastructure persistence and the Api host
with its complete vertical slices.

1. `src/Keyloop.ServiceScheduler.Infrastructure/Persistence/Migrations/20261011120048_InitialCreate.cs`;
   search `ex_appointments_bay_no_overlap`, then
   `ex_appointments_technician_no_overlap`. Explain `tstzrange`, `&&`, and the
   partial constraints excluding cancelled appointments.
2. `src/Keyloop.ServiceScheduler.Api/Features/Appointments/BookAppointment/BookAppointmentHandler.cs`;
   search `ExecuteAsync`, then `AcquireLockAsync` and
   `VerifyCommittedAsync`. Walk READ COMMITTED → dealership advisory lock →
   availability recheck → insert + audit → commit. Explain the stable appointment
   id and commit verification protecting retries after a lost acknowledgement.
3. `src/Keyloop.ServiceScheduler.Domain/Scheduling/AvailabilityCalculator.cs`;
   show full-duration intersections of free qualified resources, then mention
   dealership-local operating hours converted to UTC and deterministic allocation.
4. `src/Keyloop.ServiceScheduler.Api/Common/Problems/ProblemTypes.cs`;
   show `slot-unavailable`, `slot-conflict`, `concurrency-conflict` and
   `validation-error`. Explain `409` with `suggestedSlots` and a copyable `traceId`.

### 4:45–7:15 - Live booking, contention and observability

Use these rehearsal marks to keep the live segment within 2½ minutes:

1. **4:45–5:15 - Book.** In both tabs, click **Book appointment**, choose
   **EV Battery Health Check**, the same date and the same free slot, then advance
   from **Service & time** to **Customer & vehicle**. Prepare both dialogs before
   submitting either. In A use Alex Morgan, `alex.morgan@example.com`,
   `+44 7700 900123`, VIN `WVWZZZ1KZAW123456`, registration `AB12 CDE`, Volkswagen,
   Golf. In B use Jamie Taylor, `jamie.taylor@example.com`, `+44 7700 900124`, VIN
   `WVWZZZ1KZAW123457`, registration `AB12 CDF`, Volkswagen, Golf. Submit A; show
   `201` in Network, the allocation toast and **View on board** highlighting.
2. **5:15–5:35 - Stale-slot conflict.** Submit B's already selected slot. Show
   `409`, the warning alert, `traceId` and suggested-slot chips. The two submits
   are separate booking attempts, not an idempotency replay. Click a suggested
   slot to resubmit and show the successful recovery. Keep Network open long
   enough to show the RFC 9457 response and its `suggestedSlots` extension.
3. **5:35–5:55 - Cancel + rebook.** In A, click the original appointment block,
   then **Cancel** in its details sheet; enter `Demo slot released` and confirm.
   Open **Book appointment** and book the original EV slot again. Show that its
   original bay and technician are available after cancellation.
4. **5:55–6:20 - 30-way stress panel.** Select the third untouched EV slot,
   set **N = 30**, and click **Fire N parallel bookings**. Show **1 × 201**,
   **29 × 409**, **0 × 5xx**, p50/p95/max, and the per-request trace ids. Refresh
   the board and point to the single winning booking. If the tallies differ,
   investigate the capacity/slot setup and test output before recording.
5. **6:20–6:55 - Aspire traces and metrics.** Copy one stress-result `traceId`;
   in dashboard **Traces**, filter by that id and open the trace. Expand the
   `ui.stress_test`/fetch → API → `scheduler.book_appointment` → dealership-lock,
   availability and PostgreSQL spans. On **Metrics**, select `api` and show
   `scheduler.booking.requests` split by `outcome`, `scheduler.booking.duration`
   and `scheduler.booking.lock_wait`. Explain that
   `scheduler.booking.deadlocks` and `scheduler.booking.constraint_backstop`
   must stay at zero; an instrument with no observations may have no visible
   series. The adversarial tests assert those counters directly.
6. **6:55–7:15 - Scalar and reseed.** Click **API reference** at `/scalar/v1`,
   expand **Dealerships → GetDealerships**, click **Test Request**, then **Send**;
   show the two seeded dealerships and the typed booking schema under
   **Appointments → BookAppointment**. Return to dashboard **Resources → api →
   Commands → Reseed demo data**, run it and refresh the board to restore the
   demo. Do this after the trace demonstration; it removes the recorded bookings.

### 7:15–8:00 - Adversarial test run

Switch to the warmed terminal and run:

```bash
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release \
  --no-build --no-restore --filter "FullyQualifiedName~Concurrency"
```

Show the assertions in the concurrency test file while it runs. Explain five
independent contention rounds, no orphan rows/deadlocks, 30 distinct slots all
succeeding, and independent dealerships avoiding shared contention. End on the
actual summary. If runtime exceeds the segment, use a clearly labelled recording
cut to completion; do not substitute an invented test count or duration.

### 8:00–9:30 - AI collaboration narrative

Open [ARCHITECTURE.md §16](ARCHITECTURE.md#16-genai-co-design-record), the
local implementation plan (the author's working notes, not in the repository),
and the README's **AI Collaboration Narrative**. Show the real history:

```bash
git log -12 --oneline
git show --stat c51ba9e
```

Explain design-first planning, bounded implementation tasks and independent
review using the models and contributions actually recorded in the repository.
Use the lost-COMMIT-acknowledgement defect and its tests as one concrete review
example. Mention the decision to avoid reflection-based JSON and assembly
scanning. Distinguish completed checks from planned checks and state your own
role in reviewing the algorithms, validating behavior and owning the submission.

### 9:30–10:00 - Lessons and challenges

Return to the board. Explain why database constraints remain the final overlap
invariant, the advisory lock trades per-dealership throughput for predictable
conflicts, and `xmin` handles state-change races. Mention UTC/DST handling,
contract drift checks, and the measured EF Core/validation reflection residue.
Show the report command without spending the final seconds on another build:

```bash
scripts/aot-readiness.sh
```

Describe this as an analyzer report, not proof of NativeAOT compatibility. Close
with the practical next steps recorded in the design: authentication, deployment
migrations, load measurements and reducing the remaining reflection budget.

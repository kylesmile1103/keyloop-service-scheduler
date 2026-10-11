# Addendum B - Build-time OpenAPI, API test UI, UI/UX quality bar, visual QA in Chrome

Applies to Tasks 7–12, 14, 15–17, the new Task 17b, and Task 18 of `2026-10-11-keyloop-service-scheduler.md`. Design authority: `docs/SYSTEM_DESIGN.md` §8.6, §9.1, §15 and ADR-008, ADR-017, ADR-018. Each affected task's brief names the sections below that it must apply.

---

## B1. OpenAPI document generated at build time (Task 7 guard, Task 14 wiring)

**What "source-generated OpenAPI" means in .NET 10.** Two build-time mechanisms exist and both are adopted:

1. **XML documentation comments are compiled into OpenAPI metadata by a Roslyn source generator** shipped in `Microsoft.AspNetCore.OpenApi` (active whenever `GenerateDocumentationFile` is on - already true for the API). Zero runtime cost. See §B2.
2. **The document itself is emitted during `dotnet build`** by `Microsoft.Extensions.ApiDescription.Server`, which launches the app's entry point with a mock server (entry assembly name `GetDocument.Insider`) and serialises the document. This is build-time generation rather than a Roslyn generator, because parts of the document (route groups, filters, typed results) are only known after the composition root runs.

Runtime generation (`MapOpenApi()`) stays for Development/SystemTest/UAT so Scalar can render live changes; Production never generates documents at runtime and does not map `/openapi`.

**Wiring (Task 14).** Add `<PackageVersion Include="Microsoft.Extensions.ApiDescription.Server" Version="10.0.12" />` and reference it from the API with `PrivateAssets="all"`. In the API csproj:

```xml
<OpenApiGenerateDocumentsOnBuild>true</OpenApiGenerateDocumentsOnBuild>
<OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/../../contracts/openapi</OpenApiDocumentsDirectory>
<OpenApiGenerateDocumentsOptions>--file-name v1 --openapi-version OpenApi3_1</OpenApiGenerateDocumentsOptions>
```

Verify the emitted file name; adjust `--file-name` until the output is exactly `contracts/openapi/v1.json` (the tool appends `_<documentName>` for non-default document names).

**Guard (Task 7, `Program.cs`).**

```csharp
internal static class BuildTimeOpenApi
{
    /// <summary>True while Microsoft.Extensions.ApiDescription.Server is generating the OpenAPI document during build.</summary>
    public static bool IsActive { get; } = string.Equals(Assembly.GetEntryAssembly()?.GetName().Name, "GetDocument.Insider", StringComparison.Ordinal);
}
```

When `BuildTimeOpenApi.IsActive`: use the placeholder connection string `Host=build-time-openapi;Database=none` (never opened) instead of throwing for a missing `schedulerdb` connection string, and skip `DatabaseInitializer.InitializeAsync`. Nothing else may differ, so the build-time and runtime documents are identical.

**Determinism.** The document must be byte-stable across machines: a document transformer clears `document.Servers` (Scalar then uses the current origin), no timestamps, LF line endings. The `SystemTest`-only `/api/v1/__throw` endpoint gets `.ExcludeFromDescription()` so the SystemTest runtime document equals the build-time one.

**Contract sync (replaces `UPDATE_CONTRACT`).** `dotnet build` rewrites `contracts/openapi/v1.json`; CI fails on `git diff --exit-code contracts/`; `scripts/export-openapi.sh` becomes `dotnet build src/Keyloop.ServiceScheduler.Api -c Release && git status --short contracts/`. The Task 14 contract test is kept as a **parity test**: the runtime document served in SystemTest equals the committed build-time file (normalised JSON), every operationId from the plan is present, enums render as string values, and every 400/404/409/422/429 response references the ProblemDetails schema.

## B2. XML documentation comments → OpenAPI (Tasks 7–12)

- Endpoint handlers are **`static` methods used as method groups**, never inline lambdas, so XML comments attach to them (the RDG supports method groups). Each handler carries `/// <summary>`, `/// <remarks>` (one or two sentences of business meaning), `/// <param>` per bound parameter, and `/// <response code="...">` for every status the endpoint can return.
- Request and response records carry `/// <summary>` on each property and `/// <example>` on request properties so Scalar's *Test request* body is prefilled with a valid booking, e.g. `<example>WVWZZZ1KZAW123456</example>`, `<example>alex.morgan@example.com</example>`, `<example>2026-10-13T10:00:00Z</example>`.
- Every endpoint declares `.WithTags(...)` from the fixed list `Dealerships`, `Catalog`, `Availability`, `Appointments`, `Schedule`; a document transformer adds one-line tag descriptions in that order and sets `info.description` (markdown: what the API does, the 400/422/409 split, link to the problem catalogue section of the design).
- `CS1591` stays suppressed project-wide; the convention above is enforced by review, not by the compiler.

## B3. API test UI - Scalar (Task 7)

**Decision.** `Scalar.AspNetCore` 2.17.14 (already referenced since Task 1), served at `/scalar/v1` in Development, SystemTest and UAT; not mapped in Production.

| Option | Verdict |
|--------|---------|
| **Scalar** (`Scalar.AspNetCore`) | **Chosen.** Modern UI with a built-in API client (request history, environment variables, editable bodies), code snippets in many languages, OpenAPI 3.1, dark mode, first-class integration with `Microsoft.AspNetCore.OpenApi`. |
| Swagger UI (`Swashbuckle.AspNetCore.SwaggerUI` 10.3.0) | Viable and familiar; older UX, weaker client features. Not chosen. |
| ReDoc | Read-only documentation; no interactive requests. Rejected for "quick API test". |
| `Scalar.Aspire` 0.11.30 | Pre-1.0, adds a separate container resource to the AppHost; unnecessary while the API hosts Scalar itself. |

**Configuration** (verify method names against the Scalar .NET docs - Context7 `/scalar/scalar` - before use):

```csharp
app.MapScalarApiReference(options => options
    .WithTitle("Keyloop Service Scheduler API")
    .WithDefaultHttpClient(ScalarTarget.Shell, ScalarClient.Curl)
    .ShowOperationId()
    .ExpandAllTags());
```

The AppHost dashboard exposes a "Scalar API reference" link to `/scalar/v1` (Task 14) and the Vite dev server proxies `/scalar` (Task 15); the dispatch board's sidebar footer links to it ("API reference").

## B4. UI/UX quality bar (Tasks 15, 16, 17)

**Process.** Implementers load the `frontend-design:frontend-design` skill before writing UI code and stay inside the template's design system (Base UI primitives, Tailwind v4 tokens in `src/index.css`, `cn`). Visual direction: **"calm control room"** - neutral surfaces, one accent (the template primary), colour reserved for appointment state, dense information on an 8 px rhythm.

**Status tokens** (add to `src/index.css` for light and dark; text on tint must reach WCAG AA 4.5:1 in both themes):

| Token | Meaning | Hue family |
|-------|---------|-----------|
| `--status-confirmed` | Confirmed | blue |
| `--status-checked-in` | Checked in | sky |
| `--status-in-progress` | In progress | amber |
| `--status-completed` | Completed | emerald, muted |
| `--status-no-show` | No-show | rose |

Each status has `-bg` (≈12 % tint), `-border` (solid), `-fg`. Colour is never the only signal: the status label appears in the tooltip, the details sheet and the legend (with an icon).

**Typography.** Inter (template); `tabular-nums` for times and counts; `ui-monospace, "JetBrains Mono", monospace` for VINs and registrations; 13 px dense text in grid blocks; 600 weight for service names.

**Layout (dispatch board, ≥ 1440 px).**

```
┌ Sidebar ┐┌────────────────────────────────────────────────────────────────────────────┐
│Keyloop  ││ Dispatch Board        [Reading ▾] [◀ Tue 13 Oct ▶] [Bays|Technicians] (⟳)  │
│Service  ││                                                         [+ Book appointment]│
│Scheduler││ ┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────────────────────┐ │
│         ││ │Appointments ││Bay          ││Technicians  ││Next free slot               │ │
│▣ Board  ││ │ 23 today    ││utilisation  ││busy now 4/6 ││Interim Service · 14:15      │ │
│☰ Appts  ││ └─────────────┘└─61 %────────┘└─────────────┘└─────────────────────────────┘ │
│         ││ ┌─────────────┬──08:00────09:00────10:00────11:00──── … ──17:00─┬──────────┐ │
│         ││ │Bay 1 Std  ⓘ │ ▌Interim Service  ▌Brakes & Discs     │ now│    │          │ │
│         ││ │Bay 2 Align  │        ▌Alignment         ▌Full Service      │    │          │ │
│         ││ │Bay 4 EV  ⚡ │    ▌EV Battery Check (BO)                    │    │  closed  │ │
│ API ref ││ └─────────────┴──────────────────────────────────────────────┴────┴──────────┘ │
│ ◐ theme ││ Legend: ● Confirmed ● Checked in ● In progress ● Completed ● No-show          │
└─────────┘└────────────────────────────────────────────────────────────────────────────┘
```

**KPI strip.** Four cards, computed client-side from the schedule (and availability for the last card), with skeletons while loading: *Appointments today*; *Bay utilisation* = booked minutes ÷ (active bays × window minutes); *Technicians busy now*; *Next free slot* for Interim Service.

**Timeline grid.** Sticky header row and first column; solid hour lines, faint quarter lines; alternating hour bands; out-of-window time and closed days shaded with a diagonal hatch; a "now" line (destructive colour, 2 px) with a time label; blocks are `button`s with `rounded-md`, a 3 px left border in the status colour, status tint background, service name (truncate), VIN in mono with registration, technician avatar initials and first name. Hover raises a shadow and shows a tooltip; `focus-visible` ring; selected ring when its sheet is open; a newly booked block pulses for 3 s. Blocks narrower than 90 px collapse to service code and avatar.

**Booking dialog.** `sm:max-w-2xl`, two steps with a stepper header (1 Service & time → 2 Customer & vehicle). Slot chips grouped *Morning* / *Afternoon*, each showing the local time and capacity ("3 bays · 2 techs"); only available slots render; the selected chip uses the primary colour. Step 2 shows a summary panel (service, local time, duration, requirement badges). On success: a toast "Booked · Bay 4 · Ben Okafor · 10:00" with a *View on board* action that scrolls to and highlights the block.

**Conflict UX.** A warning `Alert` with the problem title and detail, the `traceId` in mono with a copy button, and the `suggestedSlots` as chips - one click re-submits at that slot. `422` shows the rule title and, for `no-qualified-resources`, the missing capabilities/certifications as badges. `400` maps field errors onto the form.

**Stress panel.** Large tallies (201 green, 409 amber, 5xx red - the 5xx tile is always shown, ideally reading 0), a stacked bar, latency p50/p95/max, and a table of the N requests with status pill, problem slug, duration and copyable `traceId`.

**States.** Loading: skeleton grid (rows × shimmer). Empty/closed day: icon, message, and a *Go to next open day* button. Error: `Alert` with retry and `traceId`.

**Accessibility.** WCAG 2.2 AA; every interactive element keyboard-reachable; blocks carry an `aria-label` such as "Interim Service, Bay 1, 09:00 to 10:00, Amelia Clarke, Confirmed"; dialogs and sheets trap focus (Base UI); `prefers-reduced-motion` disables the pulse and transitions.

**Responsiveness.** ≥ 1440 px full layout; 1024–1439 px the grid scrolls horizontally inside its card with the first column sticky; < 768 px the template sidebar collapses and KPI cards stack 2 × 2. Dark mode has full parity.

**Copy.** Plain workshop vocabulary: "Bay", "Technician", "Book appointment", "Slot just taken - pick another time".

## B5. Visual QA in Chrome (new Task 17b - controller-run)

Run by the controller with the `claude-in-chrome` browser tools after Task 17; findings are fixed by one implementer dispatch and then re-validated.

1. Colima and the AppHost are running; demo data exists for today and tomorrow.
2. In a new Chrome tab, at 1440 × 900 and 1024 × 768, in light and dark themes, walk: board load; switch dealership and date; technician lanes; open a block sheet and cancel it; booking dialog both steps; a successful booking (allocation visible); a forced 409 (book the only EV bay twice) with suggestions; a 400 (invalid VIN); the stress panel at 30; Scalar at `/scalar/v1` with *Test request* on `BookAppointment`.
3. Record `docs/media/booking-flow.gif` and `docs/media/stress-test.gif`; save screenshots `docs/media/board-light.png`, `board-dark.png`, `booking-dialog.png`, `conflict.png`, `stress-panel.png`, `scalar.png`.
4. Read the console (no errors or warnings allowed) and network log (no failed requests other than the intentional 409/400).
5. Score each screen against §B4: hierarchy and alignment, spacing rhythm, contrast in both themes, state coverage, keyboard focus, responsiveness, copy. Record findings with severity (Blocker / Major / Minor) in the ledger; dispatch ONE Opus implementer for Blocker+Major (and cheap Minors) with the findings and screenshot paths; re-run steps 2–4 on the changed screens.

Task 18's README embeds the screenshots and GIFs; the video guide uses the same flows.

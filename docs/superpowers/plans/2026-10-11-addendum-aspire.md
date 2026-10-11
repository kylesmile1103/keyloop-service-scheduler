# Addendum C - Aspire as the whole development platform (frontend and backend)

Applies to Tasks 7, 14, 14b, 15 and 18 of `2026-10-11-keyloop-service-scheduler.md`. Design authority: `docs/SYSTEM_DESIGN.md` §8.6, §10, §11, §12 and ADR-007, ADR-019. Each affected task's brief names the sections below that it must apply.

**Outcome.** `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` (or `aspire run`) on a clean clone, with only Docker (Colima), the .NET SDK, Node 22 and pnpm installed, does everything: it generates and persists secrets, starts PostgreSQL with a persistent volume, migrates and seeds, starts the API, installs the web dependencies, regenerates the typed client from the committed contract, starts the Vite dev server with the API discovered through Aspire, and sends telemetry from all three tiers (including the browser) to the dashboard as one correlated trace.

---

## C1. Secrets and parameters (Task 14b, AppHost)

- `var pgUser = builder.AddParameter("postgres-user", "scheduler");` and a **secret, generated, persisted** password: `var pgPassword = builder.AddParameter("postgres-password", new GenerateParameterDefault { MinLength = 24, Special = false }, secret: true, persist: true);` - verify the exact overload against the Aspire 13.6 docs (Context7 `/microsoft/aspire.dev`, "external parameters"). In run mode the value is generated once and stored in the AppHost's user secrets, so the persistent container keeps a stable password; nobody types a secret to start the stack.
- `builder.AddPostgres("postgres", pgUser, pgPassword)`.
- No secret ever appears in `appsettings*.json`, `launchSettings.json` or source. The API receives its connection string only as the `ConnectionStrings__schedulerdb` environment variable injected by `WithReference(db)`.
- Publish mode: parameters become deployment inputs (for Docker Compose, `${POSTGRES_PASSWORD}` entries in the generated `.env`); for UAT/Production the platform injects them from its secret store. Document this mapping in the README.

## C2. Resources and orchestration (Task 14b, AppHost)

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var compose = builder.AddDockerComposeEnvironment("compose");                 // publish target only (C6)

var pgUser = builder.AddParameter("postgres-user", "scheduler");
var pgPassword = builder.AddParameter("postgres-password", new GenerateParameterDefault { MinLength = 24, Special = false }, secret: true, persist: true);

var postgres = builder.AddPostgres("postgres", pgUser, pgPassword)
    .WithImageTag("17")
    .WithDataVolume("keyloop-scheduler-pgdata")
    .WithLifetime(ContainerLifetime.Persistent);
if (builder.ExecutionContext.IsRunMode)
{
    postgres.WithPgWeb(pgweb => pgweb.WithLifetime(ContainerLifetime.Persistent));
}
var db = postgres.AddDatabase("schedulerdb");

var reseedKey = builder.ExecutionContext.IsRunMode ? Guid.NewGuid().ToString("N") : null;

var api = builder.AddProject<Projects.Keyloop_ServiceScheduler_Api>("api")
    .WithReference(db)
    .WaitFor(db)
    .WithHttpHealthCheck("/health")
    .WithUrlForEndpoint("https", url => url.DisplayText = "API (https)")
    .WithUrls(ctx => ctx.Urls.Add(new() { Url = "/scalar/v1", DisplayText = "Scalar API reference", Endpoint = ctx.GetEndpoint("https") }))
    .PublishAsDockerComposeService((_, service) => service.Restart = "unless-stopped");

if (reseedKey is not null)
{
    api.WithEnvironment("Demo__ReseedKey", reseedKey)
       .WithHttpCommand("/api/v1/admin/demo/reseed", "Reseed demo data", commandOptions: new HttpCommandOptions
       {
           Method = HttpMethod.Post,
           Description = "Deletes all appointments and re-creates the deterministic demo week.",
           ConfirmationMessage = "Delete all appointments and reseed the demo week?",
           IconName = "DatabaseArrowRight",
           IsHighlighted = true,
           PrepareRequest = ctx => { ctx.Request.Headers.Add("X-Reseed-Key", reseedKey); return Task.CompletedTask; },
       });
}

builder.AddViteApp("web", "../Keyloop.ServiceScheduler.Web")
    .WithPnpm()                                   // installer child resource runs `pnpm install` before start
    .WithReference(api)                           // injects API_HTTP / API_HTTPS (and services__api__*) for the Vite proxy
    .WaitFor(api)
    .WithOtlpExporter(OtlpProtocol.HttpProtobuf)  // browser-compatible OTLP endpoint + headers for the web SDK
    .WithHttpHealthCheck("/")
    .WithExternalHttpEndpoints()
    .PublishAsDockerFile();                       // uses src/Keyloop.ServiceScheduler.Web/Dockerfile (Task 15)

builder.Build().Run();
```

Every API shape above (`WithUrls` URL model, `WithHttpCommand` options, `WithOtlpExporter(OtlpProtocol)`, `PublishAsDockerComposeService`, `WithPgWeb` configure callback, the `GenerateParameterDefault` overload) must be verified against Aspire 13.6.1 before use; adjust to the real signatures and record any deviation in the task report. Until Task 15 creates the web project, keep the `AddViteApp` block behind `if (Directory.Exists(...))` exactly as the plan says.

**AppHost launch settings.** Both profiles define `ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL` (in addition to the gRPC endpoint) so the dashboard accepts browser OTLP over HTTP; CORS for resource origins is configured automatically when the AppHost starts the dashboard.

## C3. Reseed endpoint (Task 14b, API)

`POST /api/v1/admin/demo/reseed` exists only when `Database:SeedDemoData` is true **and** `Demo:ReseedKey` is configured; it requires header `X-Reseed-Key` equal to that key (fixed-time comparison, `CryptographicOperations.FixedTimeEquals`) else `404` (not `401`, to avoid advertising the endpoint). It deletes appointments, history and idempotency rows for the demo dealerships inside one transaction and re-runs `DemoAppointmentSeeder.EnsureUpcomingWeekAsync`; returns `200 { appointmentsCreated }`. It is `.ExcludeFromDescription()` (keeps the build-time OpenAPI identical across environments) and is covered by an integration test (key wrong → 404; key right → appointments recreated, no overlaps).

## C4. Backend telemetry and logging on Aspire defaults (Task 7, ServiceDefaults + API)

- ServiceDefaults `ConfigureOpenTelemetry`: add resource attributes `deployment.environment.name` (from `IHostEnvironment.EnvironmentName`) and `service.version` (assembly informational version) via `.ConfigureResource(r => r.AddAttributes(...))`; keep `AddSource("Keyloop.ServiceScheduler")`/`AddMeter("Keyloop.ServiceScheduler")`; keep the health-endpoint trace filter.
- Logging: OpenTelemetry logging with `IncludeScopes = true` and `IncludeFormattedMessage = true` (structured properties reach the dashboard's structured-logs view); outside Development also `builder.Logging.AddJsonConsole(o => { o.IncludeScopes = true; o.UseUtcTimestamp = true; })` so container log collectors receive JSON. Log scopes carry `DealershipId`, `AppointmentId`, `IdempotencyKey` (never PII).
- Database: `EnrichNpgsqlDbContext` (already planned) supplies the DB health check (part of `/health`), Npgsql tracing and metrics, and connection retries; do not register a second health check or retry policy.
- No secrets or connection strings are logged; the startup log line reports only the environment name, migrate/seed flags and the OpenAPI/Scalar availability.

## C5. Frontend on Aspire (Task 15)

- **Discovery.** `vite.config.ts` proxy target: `process.env.API_HTTP ?? process.env.services__api__http__0 ?? "http://localhost:5180"` (the HTTP endpoint avoids dev-certificate trust problems inside the proxy). Dev server port from `process.env.PORT` with `strictPort` when set (Aspire owns the port).
- **Contract regeneration on start.** `package.json` gets `"predev": "openapi-ts"` so every `dotnet run` regenerates `src/api/*.gen.ts` from the committed contract (deterministic; CI still checks drift).
- **Browser telemetry.** Add `@opentelemetry/sdk-trace-web` 2.12.0, `@opentelemetry/sdk-trace-base` 2.12.0, `@opentelemetry/exporter-trace-otlp-proto` 0.223.0, `@opentelemetry/instrumentation` 0.223.0, `@opentelemetry/instrumentation-fetch` 0.223.0, `@opentelemetry/instrumentation-document-load` 0.68.0, `@opentelemetry/resources` 2.12.0, `@opentelemetry/semantic-conventions` 1.43.0. In `vite.config.ts`, **only when `mode === "development"`**, expose `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME` from `process.env` to the client via `define` as `import.meta.env.VITE_OTEL_*`; production builds define them empty so telemetry is off unless `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` is supplied explicitly at build time (a collector without secrets). `src/lib/telemetry.ts` initialises a `WebTracerProvider` with resource `service.name = "web-browser"` plus the parsed resource attributes, a `BatchSpanProcessor` with `OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers })`, `FetchInstrumentation` (propagates `traceparent` on same-origin `/api` calls; ignore `/v1/traces`) and `DocumentLoadInstrumentation`; it is a no-op when the endpoint is empty and never throws. The booking submit and the stress panel wrap their calls in a span (`ui.book_appointment`, `ui.stress_test`) so the dashboard shows one trace from click → `web-browser` → `api` → `postgres`. Security note in code: the OTLP API key reaches the browser **only** in Development.
- **Publish.** `src/Keyloop.ServiceScheduler.Web/Dockerfile`: multi-stage `node:22-alpine` (`corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`) → `nginxinc/nginx-unprivileged:1.27-alpine` serving `dist/` with SPA fallback and a `/api/` reverse proxy to `${API_UPSTREAM}` (templated via `/etc/nginx/templates/default.conf.template`, default `http://api:8080`), security headers, gzip, long-cache for hashed assets and `no-cache` for `index.html`.

## C6. Docker Compose publishing (Task 18)

- `aspire publish -o artifacts/compose` (with the `compose` environment from C2) generates `docker-compose.yaml` and `.env`. A fifth environment, **Demo**, is used there: `appsettings.Demo.json` = UAT security posture (rate limits on, Scalar on, HSTS off because compose serves plain HTTP behind no TLS terminator) **plus** `Database:MigrateOnStartup=true` and `Database:SeedDemoData=true`, so `docker compose up` yields a working demo without the .NET SDK. The AppHost sets `ASPNETCORE_ENVIRONMENT=Demo` for the API only in publish mode.
- Task 18 runs the publish, `docker compose --env-file artifacts/compose/.env -f artifacts/compose/docker-compose.yaml up -d`, curls `/health` and `/api/v1/dealerships` through the web container's `/api` proxy, then tears down. `artifacts/` is git-ignored; the README documents the two commands.

## C7. Whole-stack smoke test (Task 14b creates, Task 15 extends)

`tests/Keyloop.ServiceScheduler.IntegrationTests/Aspire/AppHostSmokeTests.cs` with `[Trait("Category", "Aspire")]` using `Aspire.Hosting.Testing` 13.6.1 (`DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>()`): start, wait for `api` healthy (`app.ResourceNotifications.WaitForResourceHealthyAsync("api")`), `GET /api/v1/dealerships` returns the two seeded dealerships. Task 15 adds: wait for `web` healthy and `GET /api/v1/dealerships` **through the web resource's endpoint** (proves Vite proxy + discovery). Default `dotnet test` runs exclude nothing; CI runs this category in its own step after `pnpm install`.

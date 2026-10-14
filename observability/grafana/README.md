# Grafana resources for the Unified Service Scheduler

The scheduler's Grafana resources as code: a folder, four dashboards, eight alert rule templates, the alert runbooks and an offline validator.
Nothing here has been pushed or rendered against real data; pushing is an operator action with an authenticated `gcx` context.
The API exports through the Cloudflare Worker's optional API telemetry setting ([deploy/cloudflare README](../../deploy/cloudflare/README.md#optional-api-telemetry)), enabled by [the runbook](../../deploy/cloudflare/DEPLOY-RUNBOOK.md#enable-api-telemetry).

## Layout

| Path | Purpose |
| --- | --- |
| `folders/keyloop-service-scheduler.yaml` | Folder `Keyloop Service Scheduler` |
| `dashboards/keyloop-booking-engine.yaml` | 18 panels: invariants (including the HV qualification stat), outcomes, latency, locks, traces, logs and Admin edits by resource and action |
| `dashboards/keyloop-api-health.yaml` | 13 panels: RED by route, 429s, limiter results, readiness, export presence and logs |
| `dashboards/keyloop-notifications.yaml` | 10 panels: backlog gauges, sends/failures/retries by kind, attempt age, provider duration and logs |
| `dashboards/keyloop-frontend.yaml` | 8 panels: browser TraceQL metrics/search, `ui.book_appointment`, `ui.booking_triage` and browser-to-API descendants |
| `alertrules/*.yaml` | Eight Grafana-managed alert templates: HV competence invariant, deadlocks, constraint backstop, 5xx, booking p95, oldest Pending age, dead letters, observed readiness |
| `runbooks.md` | Alert-specific investigation steps; publish at a reviewed HTTPS URL before preparing rules |
| `validation/` | Local JSON Schema, metric and label contract, PromQL behaviour tests, offline checks with their self-tests, and alert preparation |
| `../../scripts/validate-dashboards.sh` | Entry point for all offline checks, from the repository root |

Dashboards are classic panel JSON in YAML `dashboard.grafana.app/v1` resources, placed by `metadata.annotations["grafana.app/folder"]`. Alerts are `rules.alerting.grafana.app/v0alpha1`. Push only the manifest directories, never this whole directory.

## Variables and signal naming

**Datasources.** Every dashboard has `ds_metrics` (Prometheus/Mimir), `ds_logs` (Loki) and `ds_traces` (Tempo) picker variables, and stores no datasource UID. Managed stacks typically name them `grafanacloud-prom`, `grafanacloud-logs` and `grafanacloud-traces`.

**Scope.**

- `namespace` defaults to `keyloop-scheduler`, `service` to `api` (`web-browser` on Frontend).
- Metric queries select `job="${namespace}/${service}"`, which is how OTLP translation builds `job`. `target_info` is not filtered by `service_name` or `service_namespace`, because the translation keeps only `job` and `instance` there by default.
- Environment is a multi-select, `label_values(target_info{job="${namespace}/${service}"}, deployment_environment_name)`, default `Production`. Frontend reads environments from the API's resource info, since the browser emits traces only, and uses an `api_service=api` constant for end-to-end searches.
- API health adds a route picker; Notifications adds the bounded kind enum. Dashboard links keep environment, namespace, datasources and time.

**Naming.** Mimir replaces dots with underscores and adds `_milliseconds`, `_seconds`, `_total`, or `_bucket`/`_sum`/`_count` as the unit and kind require; braced count units get no suffix.
Dealership ids stay on traces and logs, never metric labels.
Admin-defined rule codes share the bounded `rule="custom"` label.
Tempo attributes keep dots.
See [Grafana OTLP format](https://grafana.com/docs/grafana-cloud/send-data/otlp/otlp-format-considerations/).

All panels have descriptions and units. Rates use `$__rate_interval` with at least a 1-minute step, and ratios stay undefined at zero traffic. Histograms are approximate until the buckets are tuned around 150 and 300 ms. No Npgsql metric name is guessed before discovery.

**First-export counters.** OTel creates a counter series on its first `Add`, so the first exported sample already holds the first event, and plain `increase()` reads 0 for it.
Must-be-zero rules and stats, the readiness rule and panel, and the Admin edits panel therefore use `validate.born_aware()`: `increase()` for series present a window ago plus `max_over_time()` for series first seen inside it.
`validation/behaviour-tests.yaml` proves it with promtool.
Never-fired counters export nothing, so these queries end in `or vector(0)` (`or on() vector(0)` when grouped); that zero does not prove telemetry is flowing.

Two gaps remain, described in the Booking deadlocks runbook: a process that dies before its first export, and a restart that reuses the `instance` label within about 15 minutes.
On Cloudflare every container restart reuses the same empty `instance` label.
Recording `Add(0)` for each must-be-zero series at startup would close that gap.

## Dealership lock hot spots

Dealership ids are not metric labels, so the lock heatmap covers the whole fleet and the hot dealership is found in Tempo. This TraceQL search lists long waits with their dealership (adjust 100 ms):

```traceql
{ resource.service.namespace = "keyloop-scheduler" && resource.service.name = "api" && resource.deployment.environment.name = "Production" && span:name = "scheduler.acquire_dealership_lock" && span.lock.wait_ms > 100 } | select(span.dealership.id, span.lock.wait_ms)
```

If the destination Tempo supports TraceQL metrics (verify on the live stack), this gives the p95 per dealership:

```traceql
{ resource.service.namespace = "keyloop-scheduler" && resource.service.name = "api" && resource.deployment.environment.name = "Production" && span:name = "scheduler.acquire_dealership_lock" } | quantile_over_time(span.lock.wait_ms, .95) by (span.dealership.id)
```

`lock.wait_ms` is in milliseconds. These are sampled trace queries, not complete populations.

## Offline validation

Prerequisites: Python 3.10 or later, gcx 1.3.0 and `promtool` from Prometheus 3.x (checked with 3.5.0).
`GCX`, `PROMTOOL` and `GRAFANA_VALIDATION_PYTHON` override the commands; `PROMTOOL` may be a container, for example `PROMTOOL="docker run --rm -v $PWD:$PWD --entrypoint promtool prom/prometheus:v3.5.0"`.
A missing tool fails the run.
After installing dependencies, validation is local and needs no Grafana login.

```bash
python3 -m venv observability/grafana/.venv
observability/grafana/.venv/bin/python -m pip install --no-cache-dir \
  -r observability/grafana/validation/requirements.txt

# Strict check against the code and ARCHITECTURE in this tree:
scripts/validate-dashboards.sh
```

The wrapper runs six stages; any failure exits non-zero.

1. **Self-tests** (`validation/test_validate.py`): each guard rejects the defect it exists for.
2. **Structure:** YAML without duplicate keys, the local JSON Schema, folder annotation, layout, links, datasource variables, and the `job` and environment scope of every selector in all 49 panels.
3. **Alert contract:** each rule's threshold, pending period, window, severity, evaluation settings and links are pinned in `validate.py` (`ALERTS`), from ARCHITECTURE section 12.3.
4. **Metric and label inventory:** every series exists in `validation/metrics.json`, every label is catalogued for its series, and every `histogram_quantile` aggregates `sum by (le, ...)` over a `_bucket` series.
   Instrument kinds and units are checked against the `Create...` calls in the folders listed in `validate.py` (`TELEMETRY`): Api `Common/Telemetry/SchedulerTelemetry.cs` and Infrastructure `Telemetry/InfrastructureTelemetry.cs` (ADR-025).
   Every custom instrument must also appear in ARCHITECTURE section 12.
   Framework instruments are checked against ServiceDefaults' `AddAspNetCoreInstrumentation` and the ASP.NET Core meter catalogue.
5. **PromQL behaviour:** `validation/behaviour-tests.yaml` runs the counter queries in promtool, including first exports, new and reused `instance` labels, other environments and jobs, and per-label alert instances.
6. **gcx lint**, no rule disabled. gcx 1.3.0 applies its dashboard rules only to `v1beta1`, so it lints temporary `v1beta1` copies and a synthetic dashboard carrying every alert query. A canary with one defect per rule must fail every rule.

`validation/resource.schema.json` is a project authoring contract based on the classic dashboard model and [Grafana's AlertRule spec](https://github.com/grafana/grafana/blob/main/apps/alerting/rules/pkg/apis/alerting/v0alpha1/alertrule_spec_gen.go). It cannot prove compatibility with the destination's alpha API, query execution, renderer or live labels.

The strict check reads both backlog gauges from `InfrastructureTelemetry.cs`: `scheduler.notifications.outbox_pending` (`{notification}`, `kind` label) and `scheduler.notifications.oldest_pending_age` (`s`).

## Local alert preparation

Alert evaluation has no dashboard variables, so the templates use `${METRICS_DATASOURCE_UID}`, `${ENVIRONMENT}`, `${API_JOB}`, `${ALERT_RECEIVER}` and `${RUNBOOK_BASE_URL}` placeholders. Fill them locally, review the result, and never push the templates themselves.

```bash
# These are reviewed non-secret settings. Substitute real choices locally.
observability/grafana/.venv/bin/python \
  observability/grafana/validation/prepare-alerts.py \
  --metrics-datasource-uid '<existing-mimir-uid>' \
  --environment Production \
  --api-job keyloop-scheduler/api \
  --receiver '<existing-reviewed-contact-point-name>' \
  --runbook-base-url 'https://<reviewed-host>/<published-path>/runbooks.md'

scripts/validate-dashboards.sh \
  --alerts-dir observability/grafana/.review/alertrules
```

The script writes eight files to `.review/alertrules`, refuses to overwrite a previous review, rejects unresolved placeholders and never calls Grafana. With `--alerts-dir`, each prepared rule must equal its tested template apart from one consistent value per placeholder. Use a new `--output-dir` for a changed review.

All rules evaluate each minute with `noDataState: Ok` and `execErrState: Error`, and link a dashboard panel and a runbook:

| Rule | Condition | Pending period |
| --- | --- | --- |
| HV competence | Any first-export-aware increment of `scheduler_allocation_below_hv_minimum_total` pages immediately | 0s |
| Deadlocks | 10-minute increase > 0 | 0s |
| Constraint backstop | 10-minute increase by constraint > 0 | 0s |
| API 5xx | 10-minute ratio > 0.001, excluding health routes | 5m |
| Booking p95 | 5-minute p95 > 300 ms and throughput > 0.02/s | 5m |
| Outbox age | Oldest Pending gauge > 300 s | 10m |
| Dead letters | 15-minute increase by kind > 0 | 0s |
| Readiness | Observed `/health` or `/alive` non-2xx in 5 minutes | 0s |

Dead letters are ticket severity. On Cloudflare nothing polls the container's `/health`, and the Durable Object pings only `localhost/alive` during start, so the readiness rule covers failed start pings only. Pointing that ping at `/health` would make it a database readiness signal. An idle container sleeps, so missing `target_info` is not an outage, and an external uptime check would wake it.

## Prerequisites for a push

- An authenticated `default` gcx context with folder, dashboard and alert-rule write permission and read access to the Mimir, Loki and Tempo datasources. CI needs a separately managed service account token. No credentials in these files or in command arguments.
- API telemetry enabled on the Worker, which yields `job="keyloop-scheduler/api"` and `deployment_environment_name="Production"` ([telemetry variables](../../deploy/cloudflare/README.md#optional-api-telemetry)). Browser telemetry would need its own `traces:write` token. The exporter is tested only against a loopback receiver with a fake token.
- For alerts: the runbooks published at a reviewed HTTPS URL and an existing reviewed contact point. Routing names only that receiver; no notification policy tree is authored.

## Pushing to Grafana

Check each command's `--help` first. Never add `--assume-server-dry-run` for alerts (the alpha AlertRule API has no server dry run) and never pass `--include-managed`.

```bash
# Preflight, not an offline validator:
gcx resources validate --context default \
  -p observability/grafana/folders -p observability/grafana/dashboards -o json
gcx resources push --context default \
  -p observability/grafana/folders -p observability/grafana/dashboards --dry-run

# REQUIRES USER CONFIRMATION: creates/updates the folder and four dashboards.
gcx resources push --context default \
  -p observability/grafana/folders -p observability/grafana/dashboards --on-error abort

# REQUIRES USER CONFIRMATION: real write of eight locally prepared rules.
# Only after strict metric verification, routing and runbook review.
gcx resources push --context default \
  -p observability/grafana/.review/alertrules --on-error abort
```

Afterwards, read the resources back, check evaluation health, and render the four dashboards with the chosen datasources.

## Acceptance against deployed data

- **Scope:** `count by (job, service_namespace, service_name) (http_server_request_duration_seconds_count{job="keyloop-scheduler/api"})` must show `job` equal to `service_namespace/service_name`, and `count by (deployment_environment_name) (target_info{job="keyloop-scheduler/api"})` must list the environments the variable offers.
- **Metrics:** check translation, environment label case, job and instance identity, the booking route spelling, histogram boundaries and limiter labels.
- **Notifications:** the backlog gauges refresh with dispatch disabled, count delayed retries and leases, and tell an empty queue from a failed observation. Depth sums by kind assuming one reporter; several API instances would overcount.
- **Browser:** both UI spans and `documentLoad` arrive, and browser and API spans share a trace id. Confirm the [Tempo query model](https://github.com/grafana/grafana/blob/v12.3.0/public/app/plugins/datasource/tempo/dataquery.gen.ts) (`queryType: traceql`, `metricsQueryType: range`) and TraceQL metrics support on the destination.
- **Logs and exemplars:** check Loki labels and message filters. Exemplar links stay disabled because the managed datasource expects `traceID` while OTLP exemplars carry `trace_id` ([OpenTelemetry Prometheus compatibility](https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/)).
- **Alerts:** confirm the alpha rule schema on the stack before any rule push, then inspect evaluation errors.

A local lint and schema pass proves authoring consistency. Real query results, alert behaviour and rendered usability remain post-deploy acceptance work.

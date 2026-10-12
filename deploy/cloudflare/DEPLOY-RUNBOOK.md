# First deployment runbook: core profile

This is the ordered command list for the first deployment of the scheduler to `keyloop.kylesmile.me`: the board, booking and Access sign-in. Intake triage, email, the browser OTLP relay and API telemetry stay off; [Enable API telemetry](#enable-api-telemetry) turns the last on afterwards. The database is Neon Free PostgreSQL 17 in London. [README.md](README.md) holds the configuration contract and the reasoning; this file only orders the work.

Every step marked **REQUIRES USER CONFIRMATION** changes the Cloudflare or Neon account. Run it only after the stakeholder has confirmed that step. Everything else is local. This file names no account, identifier, email address or secret: `<...>` marks a value you supply, and the role lists stay outside the repository.

## 0. Ground rules for this session

- Use a clean checkout of the commit you deploy, from the repository root. Record it: `export KL_SHA=$(git rev-parse --short=12 HEAD)`.
- Type every secret into a hidden prompt (`read -rs NAME`) and refer to it only as `"$NAME"`. Never write a secret, email list or connection string as a literal in a command, a file in the repository or a ticket. `unset` each one when its step is done.
- Two connection-string forms are needed. `psql` takes a `postgresql://` URI (without the password, which travels in `PGPASSWORD`). The migration bundle and the runtime secret take the Npgsql keyword form `Host=...;Port=5432;Database=...;Username=...;Password=...;SSL Mode=VerifyFull;Channel Binding=Require`. The API refuses a URI at startup, and an older image printed the whole URI, password included, in its crash output, so never give it one.
- Use Neon's **direct** endpoint host, the one without `-pooler` (ADR-022: direct TLS). The API keeps its own Npgsql pool, and the migration bundle needs a direct connection.
- If any command fails, read its output for secrets before you copy it anywhere.
- Tools: .NET SDK 10.0.100 or later, Node 22 through nvm, pnpm 12.9.1, Docker (on this Mac, Colima: `colima status`), `jq`, `curl`, `uuidgen`. For `psql`, either `brew install libpq` (then `export PATH="$(brew --prefix libpq)/bin:$PATH"`) or the `postgres:17` image through `alias psql='docker run --rm -it -e PGPASSWORD -v "$PWD/deploy/neon:/repo/deploy/neon:ro" -w /repo postgres:17 psql'`; that image has no CA bundle, so with it replace `sslmode=verify-full&sslrootcert=system` below by `sslmode=require` (encrypted, but the server certificate is not verified).
- The `cf` CLI is pinned in this project:

```sh
cd deploy/cloudflare
source ~/.nvm/nvm.sh && nvm use 22
npm ci --no-audit --no-fund
export CF_SEND_TELEMETRY=false WRANGLER_SEND_METRICS=false
alias cf="$PWD/node_modules/.bin/cf"
cd ../..
```

Use `--dry-run` on a `cf` command first whenever it offers one. If your login sees more than one account, set `CLOUDFLARE_ACCOUNT_ID` for the session (an identifier, not a credential).

## 1. Neon: database, migrations and the runtime role

1. **REQUIRES USER CONFIRMATION (stakeholder):** the Neon Free project on PostgreSQL 17 in AWS London (`eu-west-2`), the database `keyloop_scheduler` owned by the owner role, and compute fixed at 0.25 CU (autoscaling minimum and maximum both 0.25). Scale to zero stays on.

2. Enter the connection parts (hidden where secret):

```sh
read -r  NEON_HOST       # direct endpoint host, without -pooler
read -r  NEON_OWNER      # the owner role's name
read -rs NEON_OWNER_PW   # the owner role's password (hidden)
```

3. Build the migration bundle locally. It is a self-contained macOS arm64 executable of about 160 MB under the ignored `artifacts/` directory; never commit it.

```sh
dotnet tool restore
dotnet ef migrations bundle --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api --configuration Release \
  --self-contained --target-runtime osx-arm64 --output artifacts/keyloop-efbundle-osx-arm64 --force
```

4. **REQUIRES USER CONFIRMATION:** apply the migrations as the owner. The connection string is assembled from the variables, so neither the password nor the string reaches the shell history. It is visible to local `ps` for the few seconds the bundle runs.

```sh
export KEYLOOP_OWNER_CONN="Host=$NEON_HOST;Port=5432;Database=keyloop_scheduler;Username=$NEON_OWNER;Password=$NEON_OWNER_PW;SSL Mode=VerifyFull;Channel Binding=Require"
./artifacts/keyloop-efbundle-osx-arm64 --connection "$KEYLOOP_OWNER_CONN"
unset KEYLOOP_OWNER_CONN
```

Expected: five `Applying migration '...'` lines and `Done.` A second run applies nothing.

5. **REQUIRES USER CONFIRMATION:** create the runtime role **with SQL**. A role created in the Neon Console, CLI or API joins `neon_superuser` and is not DML-only; `runtime-role.sql` refuses such a role. If `scheduler_app` already exists from the Console, delete it there first. Generate its password into a variable and the clipboard, paste it at both hidden `\password` prompts, then clear the clipboard:

```sh
export PGPASSWORD="$NEON_OWNER_PW"
export KEYLOOP_OWNER_URI="postgresql://$NEON_OWNER@$NEON_HOST/keyloop_scheduler?sslmode=verify-full&sslrootcert=system"
KL_APP_PW="$(openssl rand -hex 32)"
printf '%s' "$KL_APP_PW" | pbcopy
psql "$KEYLOOP_OWNER_URI" -v ON_ERROR_STOP=1 -c 'CREATE ROLE scheduler_app LOGIN'
psql "$KEYLOOP_OWNER_URI" -c '\password scheduler_app'
pbcopy < /dev/null
```

6. **REQUIRES USER CONFIRMATION:** grant DML only. The script checks that the role is a plain login role with no memberships, that it runs as the owner of the migrated tables, then grants and verifies in one transaction. Run it again after every future migration bundle.

```sh
psql "$KEYLOOP_OWNER_URI" -v ON_ERROR_STOP=1 -f deploy/neon/runtime-role.sql
```

Expected: `NOTICE: scheduler_app: DML on 10 application tables, read-only migration history, no DDL`, then `COMMIT`.

7. Check from the runtime role's side, with the password still in `KL_APP_PW`, that it can read but cannot change the schema:

```sh
PGPASSWORD="$KL_APP_PW" psql "postgresql://scheduler_app@$NEON_HOST/keyloop_scheduler?sslmode=verify-full&sslrootcert=system" \
  -c 'SELECT count(*) FROM "__EFMigrationsHistory"' -c 'CREATE TABLE public.ddl_probe (id int)'
```

Expected: `5`, then `ERROR: permission denied for schema public`.

8. Keep `KL_APP_PW` and `NEON_HOST` for step 2.3, then: `unset PGPASSWORD NEON_OWNER_PW KEYLOOP_OWNER_URI NEON_OWNER`.

## 2. Cloudflare login and Secrets Store

1. Log in (opens the browser): `cf auth login`.
2. **REQUIRES USER CONFIRMATION:** the Secrets Store. List first with `cf secrets-store stores list`; reuse the account's store if one exists. Otherwise create one in the dashboard (Secrets Store) or with `npx wrangler secrets-store store create keyloop-scheduler --remote` (the `cf` CLI has no store-create command). Then `export KEYLOOP_SECRETS_STORE_ID=<store id>`.
3. **REQUIRES USER CONFIRMATION (stakeholder enters the value):** the secret `keyloop_prod_db_url` with scope `workers`. Put its value on the clipboard, paste it into the dashboard's value field (preferred) or Wrangler's value prompt, then clear the clipboard. Do not use `cf secrets-store secrets create --body` or Wrangler's `--value`: both take the secret as an argument.

```sh
printf 'Host=%s;Port=5432;Database=keyloop_scheduler;Username=scheduler_app;Password=%s;SSL Mode=VerifyFull;Channel Binding=Require' \
  "$NEON_HOST" "$KL_APP_PW" | pbcopy
(cd deploy/cloudflare && npx wrangler secrets-store secret create "$KEYLOOP_SECRETS_STORE_ID" \
  --name keyloop_prod_db_url --scopes workers --remote)
pbcopy < /dev/null
unset KL_APP_PW
```

## 3. Access: one self-hosted application on `/auth/*`

The bodies are committed with placeholders under [access/](access/). Fill them in the ignored `build/` directory, never in the committed files.

```sh
mkdir -p deploy/cloudflare/build/access
cp deploy/cloudflare/access/*.json deploy/cloudflare/build/access/
```

1. Team domain: `cf zero-trust organization get` and read `auth_domain`. If there is no Zero Trust organization yet, create it in the dashboard (**REQUIRES USER CONFIRMATION**). Then `export KEYLOOP_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com`.
2. One-time PIN: `cf zero-trust identity-providers list`. If no provider has `"type": "onetimepin"`, **REQUIRES USER CONFIRMATION:**

```sh
cf zero-trust identity-providers create --body "$(cat deploy/cloudflare/build/access/identity-provider-otp.json)"
```

Note the provider's `id`. No other identity provider is added for this deployment.

3. **REQUIRES USER CONFIRMATION:** the Allow policy. Replace the `__REVIEWER_EMAIL_n__` placeholders in `build/access/policy-reviewers.template.json` with the approved reviewer emails (add or remove entries; an approved whole domain is `{ "email_domain": { "domain": "<domain>" } }`). Every person in a role list in step 6 must also be allowed here, plus at least one allowed email in no role list for the 403 rehearsal. Never use an unrestricted one-time PIN rule or a Bypass policy.

```sh
cf zero-trust access policies create --body "$(cat deploy/cloudflare/build/access/policy-reviewers.template.json)"
```

Note the policy `id`.

4. **REQUIRES USER CONFIRMATION:** the application. In `build/access/application.template.json`, replace `__ONE_TIME_PIN_IDP_ID__` and `__REVIEWERS_POLICY_ID__`. The body selects: self-hosted on `keyloop.kylesmile.me/auth/*` only (the board, assets and `/api/v1/*` stay public at Access), session 1 hour, one-time PIN as the only allowed IdP with automatic redirect, Cookie Path Attribute **disabled** (`path_cookie_attribute: false`, so the cookie reaches `/api/v1/*`), `HttpOnly`, `SameSite=Lax`, binding cookie off, hidden from the App Launcher.

```sh
cf zero-trust access applications create --body "$(cat deploy/cloudflare/build/access/application.template.json)"
```

5. Read the AUD tag: `cf zero-trust access applications get <application id>` and take `aud`. Then `export KEYLOOP_ACCESS_AUDIENCE=<aud>`. It is an identifier for the API's token check, not a credential.

## 4. Local builds and checks

```sh
# SPA: no telemetry endpoint and the same origin for the API
(cd src/Keyloop.ServiceScheduler.Web && pnpm install --frozen-lockfile && \
  env -u VITE_OTEL_EXPORTER_OTLP_ENDPOINT -u OTEL_EXPORTER_OTLP_ENDPOINT -u VITE_API_BASE_URL pnpm build)

# API image for Cloudflare's linux/amd64 runtime; one plain manifest, no attestations
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -f src/Keyloop.ServiceScheduler.Api/Dockerfile -t "keyloop-scheduler-api:$KL_SHA" --load .
docker image inspect "keyloop-scheduler-api:$KL_SHA" --format '{{.Id}} {{.Architecture}} {{json .Config.Entrypoint}}'

# The image must exit on a startup failure (default Production settings fail validation without a database)
timeout 120 docker run --rm --platform linux/amd64 --network none -e DOTNET_EnableWriteXorExecute=0 "keyloop-scheduler-api:$KL_SHA"; echo "status $?"

# Edge offline checks (no account, no network)
(cd deploy/cloudflare && npm run typecheck && npm test && npm run validate:build && npm run validate:build:integrations)
```

Expected: `amd64` and the `tini` entrypoint; `status 134` within seconds (124 would mean it hangs); all edge checks pass. `DOTNET_EnableWriteXorExecute=0` is only for running the amd64 image under emulation on an Apple silicon Mac, where .NET otherwise stalls; it is never part of the deployment.

## 5. Push the API image

**REQUIRES USER CONFIRMATION:**

```sh
cf containers push --tag "keyloop-scheduler-api:$KL_SHA" --dry-run
cf containers push --tag "keyloop-scheduler-api:$KL_SHA"
cf containers images list
```

Take the pushed reference, `registry.cloudflare.com/<account id>/keyloop-scheduler-api:<KL_SHA>`, and `export KEYLOOP_API_IMAGE=<that reference>`.

## 6. Build the edge with the real identifiers

The role lists are typed privately, so they reach neither history nor the repository:

```sh
export KEYLOOP_NOTIFICATIONS_ENABLED=false KEYLOOP_EMAIL_SENDING_ENABLED=false
export KEYLOOP_OTLP_RELAY_ENABLED=false KEYLOOP_TRIAGE_ENABLED=false KEYLOOP_API_OTLP_ENABLED=false KEYLOOP_EMAIL_TRANSPORT=binding
read -r KEYLOOP_ACCESS_ADMIN            # comma-separated emails or @domain entries
read -r KEYLOOP_ACCESS_SERVICE_ADVISOR
read -r KEYLOOP_ACCESS_VIEWER
export KEYLOOP_ACCESS_ADMIN KEYLOOP_ACCESS_SERVICE_ADVISOR KEYLOOP_ACCESS_VIEWER
cd deploy/cloudflare
npm run build    # assembles build/assets from the SPA, then runs only `cf build` (no account access)
jq '{name, domains, workersDev, previewUrls, triggers, env: (.env | del(.AUTH_ADMIN, .AUTH_SERVICE_ADVISOR, .AUTH_VIEWER)
  | with_entries(.value |= (if has("value") then .value elif has("secretName") then "secret:\(.secretName)" else (.type // "binding") end)))}' \
  .cloudflare/output/v0/workers/default/worker.config.json
jq '{name, instanceType, maxInstances, constraints, image, schedulingPolicy}' .cloudflare/output/v0/containers/keyloop-scheduler-api/container.config.json
```

Check before going on: domain `keyloop.kylesmile.me`, `workersDev` and `previewUrls` false, no triggers; `DB_URL` is `secret:keyloop_prod_db_url`; `AUTH_TEAM_DOMAIN` and `AUTH_AUDIENCE` are yours; there is no `EMAIL_API_TOKEN`, `GRAFANA_OTLP_BASIC_BROWSER`, `API_OTLP_TOKEN`, `AI_TOKEN` or `TRIAGE_IMAGES` binding; `NOTIFICATIONS_ENABLED`, `EMAIL_SENDING_ENABLED`, `OTLP_RELAY_ENABLED`, `API_OTLP_ENABLED` and `TRIAGE_ENABLED` are `false`; the container is `basic`, one instance, `WEUR`, with your pushed image. `.cloudflare/` is ignored; it holds the role lists in plain text, so do not share it.

## 7. Deploy

**REQUIRES USER CONFIRMATION:** inspect the plan, then deploy exactly what was built. `--provision=false` keeps the deployment from creating any resource it was not given (README F10).

```sh
cf deploy --prebuilt --provision=false --dry-run
cf deploy --prebuilt --provision=false --message "core profile $KL_SHA"
```

This creates the Worker `keyloop-scheduler`, its `ApiContainer` Durable Object class and Container application, and the Custom Domain `keyloop.kylesmile.me` from the configuration's `domains` (DNS record and certificate). The first API request creates the Durable Object `api` with the `weur` hint and cold-starts the container. If the plan shows the `EMAIL` send-email binding needs Email onboarding on the zone, stop: that binding is in every build, and onboarding (README step 2) or making it conditional is a separate decision.

## 8. Redirect HTTP to HTTPS

**REQUIRES USER CONFIRMATION**, one of:

- Zone-wide: `cf zones settings edit always_use_https --zone kylesmile.me --body '{"value":"on"}'`. This redirects every hostname in the zone.
- This hostname only, a Single Redirect rule. Find the zone's `http_request_dynamic_redirect` entrypoint with `cf rulesets list --zone kylesmile.me`, then add the rule to it with `cf rulesets rules create <ruleset id> --zone kylesmile.me --body "$(cat <rule file>)"`. If there is no such ruleset, create it with `cf rulesets create --zone kylesmile.me --kind zone --phase http_request_dynamic_redirect --name default --rules '[<rule>]'`. Never replace an existing entrypoint, which would drop its other rules. The rule:

```json
{
  "description": "keyloop.kylesmile.me: HTTP to HTTPS",
  "expression": "(http.host eq \"keyloop.kylesmile.me\" and not ssl)",
  "action": "redirect",
  "action_parameters": {
    "from_value": {
      "status_code": 301,
      "target_url": { "expression": "concat(\"https://\", http.host, http.request.uri.path)" },
      "preserve_query_string": true
    }
  }
}
```

The static assets already send host-only HSTS (`public/_headers`), and browsers record it only from a valid HTTPS response.

## 9. Rehearsal

Run from the repository root (`cd ../..` after step 7) with `H=https://keyloop.kylesmile.me` and `READING=$(curl -sS "$H/api/v1/dealerships" | jq -r '.[] | select(.name == "Keyloop Motors Reading") | .id')`. Any failure stops the rollout; README's Access checklist (items 7 to 9) is the source for each check.

1. Cold start within 60 s, right after the deploy or after 30 idle minutes: `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$H/api/v1/dealerships"`. Expected `200` in under 60 s; a `503` with `E_API_UNAVAILABLE` means the container did not start (check the Container and Worker logs in the dashboard, which never show the secret).
2. HTTP to HTTPS and HSTS: `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://keyloop.kylesmile.me/board` gives `301 https://keyloop.kylesmile.me/board`; `curl -sSI "$H/" | grep -i strict-transport-security` gives `max-age=31536000`.
3. Nothing internal is public: `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n'` on `$H/health`, `$H/alive`, `$H/scalar/v1` and `$H/openapi/v1.json` each answers from Static Assets (the SPA's `index.html`, or a plain 404 for a request that is not a navigation), never with API JSON or a health report; `curl -sS -X POST -o /dev/null -w '%{http_code}\n' "$H/api/v1/admin/demo/reseed"` gives `404`.
4. Signed-out reads are masked: `curl -sS "$H/api/v1/dealerships/$READING/schedule?date=<open weekday>" | jq '.. | objects | select(has("customerName")) | {customerName, vin, registration}' | head`. Names are initials, VINs show only the last six characters, registrations are `*******`; no email or phone appears. `curl -sS "$H/api/v1/me"` gives `"authenticated": false`.
5. Each role, in a private browser window per person: open `$H/auth/login?returnTo=%2Fboard`, sign in with the one-time PIN, and expect to land on `/board`. Then `$H/api/v1/me` shows that person's role. ServiceAdvisor and Admin can book and cancel; a Viewer sees full names and opens appointment details but cannot book (the UI shows why); every role sees unmasked names.
6. An allowed email in no role list signs in, `/api/v1/me` shows `"authenticated": true` with `"roles": []`, and the board shows booking unavailable with the reason; the rehearsal script in item 8, given that session, stops with `roles=[]` (the API answers such a write with 403, proven locally).
7. Sign out at `$H/cdn-cgi/access/logout`: the `CF_Authorization` cookie for the hostname is gone, `/api/v1/me` is anonymous again, reads are masked and writes answer 401.
8. The 30-way booking: sign in as a ServiceAdvisor, copy the `CF_Authorization` cookie value from the browser's developer tools, then run the script; it asks for the value without echoing it, books one single-capacity slot 30 times at once and cancels the winner.

```sh
deploy/cloudflare/scripts/rehearse-contention.sh "$H"
```

Expected: `201: 1   409: 29   other: 0` and `PASS`. The k6 profiles in `tests/load/k6` send no Access identity, so they cannot run writes against this deployment.

9. Clean up local state: `unset NEON_HOST KEYLOOP_ACCESS_ADMIN KEYLOOP_ACCESS_SERVICE_ADVISOR KEYLOOP_ACCESS_VIEWER`, and delete `deploy/cloudflare/build/access/`.

## Enable API telemetry

This turns on the API's OTLP export (traces, metrics and logs) to the stakeholder's Grafana Cloud stack on a running core deployment. The committed dashboards select `job="keyloop-scheduler/api"` and the environment `Production`, which is what this export produces; the variables the container receives and why are in [README](README.md#optional-api-telemetry). Build both the API image and the edge from a commit that contains this change: the Worker code that passes the OTLP settings and the API's quieter Production log levels ship in them. Step 0 still applies; `H=https://keyloop.kylesmile.me`.

1. **REQUIRES USER CONFIRMATION (stakeholder, Grafana Cloud):**
   - Read the stack's OTLP endpoint and instance ID from the stack's **OpenTelemetry** tile (**Configure**) in the Grafana Cloud portal. The endpoint has the form `https://otlp-gateway-<region>.grafana.net/otlp`; the instance ID is a number. Both are identifiers, not secrets.
   - Create a Cloud access policy whose realm is this stack only, with the scopes `metrics:write`, `logs:write` and `traces:write` and no others, and add one token to it (for example `keyloop-scheduler-api`, with the expiry you choose). Grafana shows the token once. It never goes into chat, a ticket, a file or a command line.
2. **REQUIRES USER CONFIRMATION (stakeholder, Cloudflare):** add the token to the Secrets Store `keyloop` as `keyloop_prod_api_otlp_token` with the scope **Workers**. Either in the dashboard (Secrets Store, `keyloop`, create secret, paste the token as the value), or from the repository root with the value typed into a hidden prompt. `printf` is a shell builtin, so the token reaches neither the history nor the process list, and Wrangler reads it from standard input when it is not a terminal:

```sh
export KEYLOOP_SECRETS_STORE_ID=<id of the keyloop store>   # cf secrets-store stores list
read -rs KL_API_OTLP_TOKEN                                  # paste the Grafana token, then Enter; nothing is echoed
printf '%s' "$KL_API_OTLP_TOKEN" | (cd deploy/cloudflare && npx wrangler secrets-store secret create "$KEYLOOP_SECRETS_STORE_ID" \
  --name keyloop_prod_api_otlp_token --scopes workers --remote)
unset KL_API_OTLP_TOKEN
```

Expected: `Creating secret... (Name: keyloop_prod_api_otlp_token, Value: REDACTED, Scopes: workers, ...)`. Never use Wrangler's `--value` or `cf secrets-store secrets create --body`.

3. Build the API image from that commit and run the local checks of [step 4](#4-local-builds-and-checks). **REQUIRES USER CONFIRMATION:** push it as in [step 5](#5-push-the-api-image) and `export KEYLOOP_API_IMAGE=<the pushed reference>`. The new image carries `appsettings.Production.json`, which keeps one log record per SQL command and per outgoing HTTP request (the exporter's own included) out of the console and Loki.
4. Build the edge as in [step 6](#6-build-the-edge-with-the-real-identifiers), with the live deployment's settings plus the three telemetry settings:

```sh
export KEYLOOP_API_OTLP_ENABLED=true
export KEYLOOP_GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp   # from the OpenTelemetry tile, no trailing slash
export KEYLOOP_GRAFANA_INSTANCE_ID=<instance id>                                     # digits only
```

`KEYLOOP_OTLP_RELAY_ENABLED` stays `false`; the browser relay is a separate decision with its own `traces:write` credential. A malformed endpoint or instance ID fails `npm run build` (`cf build`) with the setting's name. In the `jq` output expect `API_OTLP_TOKEN` as `secret:keyloop_prod_api_otlp_token`, `API_OTLP_ENABLED` `true`, and your `GRAFANA_OTLP_ENDPOINT` and `GRAFANA_INSTANCE_ID`; everything else as in step 6.

5. **REQUIRES USER CONFIRMATION:** deploy as in [step 7](#7-deploy), with `--message "api telemetry $KL_SHA"`. The dry run should show the new Worker version, the three new bindings and the new image, nothing else. The rollout restarts the singleton container; wake it with `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$H/api/v1/dealerships"`, which must answer `200`. A `503` with `E_API_UNAVAILABLE` means the container did not start: a missing or malformed `keyloop_prod_api_otlp_token` (whitespace or a non-ASCII character) refuses the start with a message that names only the secret, in the Worker log.
6. **REQUIRES USER CONFIRMATION:** deploy the Grafana folder and the four dashboards with the export, so its data lands on the reviewed panels. They are unchanged by this work; if they are already pushed and untouched since, the dry run reports no change. Use the stakeholder's authenticated `gcx` context ([observability README](../../observability/grafana/README.md#later-stakeholder-commands)):

```sh
gcx resources push --context default -p observability/grafana/folders -p observability/grafana/dashboards --dry-run
gcx resources push --context default -p observability/grafana/folders -p observability/grafana/dashboards --on-error abort
```

7. Verify, read-only, in Grafana Explore after two or three minutes of traffic (metrics are exported every 60 seconds):
   - Metrics: `count by (job, service_namespace, service_name) (http_server_request_duration_seconds_count{job="keyloop-scheduler/api"})` shows that job, and `count by (deployment_environment_name) (target_info{job="keyloop-scheduler/api"})` shows `Production`.
   - Logs: `{service_namespace="keyloop-scheduler", service_name="api"}` has the startup event `1102` and no `Executed DbCommand` records.
   - Traces: `{ resource.service.namespace = "keyloop-scheduler" && resource.service.name = "api" }` finds the request's server span.
   - The API health and Booking engine dashboards, Environment `Production`, fill as requests arrive.

   If nothing arrives, the container log will not say why: the .NET SDK reports export failures only through its own diagnostics event source. Check the token's realm (this stack) and scopes, the instance ID, and that the endpoint is the stack's own region.

While telemetry is on, the backlog gauges query the database once per metric export, so Neon stays awake as long as the container runs (up to its 30 idle minutes) instead of suspending after Neon's idle timeout; watch the Free plan's compute hours.

To disable, export `KEYLOOP_API_OTLP_ENABLED=false`, rebuild (step 6) and deploy (step 7): the binding and every OTEL variable disappear. To rotate, add a new token to the same policy, replace the secret's value (dashboard, or `npx wrangler secrets-store secret update "$KEYLOOP_SECRETS_STORE_ID" --secret-id <id> --remote` with the same `read -rs` and `printf` pattern), redeploy so the container restarts, then delete the old token in Grafana. Deleting the token in Grafana stops ingestion at once.

## Rollback

- API image: push the previous tag, set `KEYLOOP_API_IMAGE` to it, rebuild (step 6) and deploy (step 7). The singleton container restarts briefly.
- A bad database secret: replace `keyloop_prod_db_url` in Secrets Store, then restart the container by redeploying; a running container keeps its start-time value.
- Neon restores within its six-hour Free history window. Access application and policy changes are reversible in the dashboard.

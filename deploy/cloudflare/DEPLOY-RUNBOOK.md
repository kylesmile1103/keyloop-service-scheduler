# Public demo deployment runbook

## Deploy from GitHub Actions

Routine releases run from [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml). The `production` environment requires reviewer approval, so nothing reaches the live site without a person approving it. The manual steps further down are the bootstrap path for a first deployment and the break-glass fallback. CI in `ci.yml` is unchanged.

**Triggers and guards.**

- Both `workflow_dispatch` and `workflow_run` need this workflow on the default branch, `main`.
- A successful `CI` push run on `main` plans its exact `head_sha`. A manual run must select `main` and prove the SHA already passed push CI. Fork and PR completions, other CI events and failed CI never plan.
- Before planning, migrating and deploying, the workflow checks the commit is still the head of `main`, so a delayed approval cannot roll back a newer commit.
- Both environments accept branch `main` only. Build inputs live in the `plan` environment, never repository-wide.

**Job graph.** `plan -> [migrate, if manually requested] -> deploy -> verify`.
`deploy` accepts a skipped migration and refuses a failed or cancelled one.
The `deploy-production` concurrency group (`cancel-in-progress: false`) never interrupts an active migration or deploy.
Runners are disposable Ubuntu machines.
Token permissions are `contents: read`; only `plan` adds `actions: read`, to check a manual run's CI evidence and that `production` has a required reviewer before publishing the image.

| Job | Environment | What it does |
| --- | --- | --- |
| `plan` | `plan`, no reviewers | Builds the `linux/amd64` API image with a 12-character SHA tag and pushes it with `cf containers push` (a push rolls nothing out). Builds the same-origin SPA and the edge, then runs `cf deploy --prebuilt --provision=false --dry-run`. The summary shows SHA, tag, container policy and binding labels, without values or account ids. Failed `cf` output is redacted by `scripts/print-redacted-error.sh` |
| `migrate` | `production`, only with manual `migrate=true` | Restores the pinned `dotnet-ef`, builds a self-contained `linux-x64` bundle (`KEYLOOP_BUILD_MIGRATION_BUNDLE=true` skips OpenAPI generation), applies pending migrations as the Neon owner, then reapplies and verifies `deploy/neon/runtime-role.sql`. The runtime role must already exist ([step 1](#1-neon-database-migrations-and-the-runtime-role)). `deploy/neon/github-migrate` requires a direct host with `SSL Mode=VerifyFull;Channel Binding=Require` and never echoes the connection |
| `deploy` | `production` | Rebuilds the SPA and edge for the planned SHA and deploys with `--prebuilt --provision=false --message "<sha> via GitHub Actions run <run_id>"`. No bundle or `.cloudflare/output` crosses jobs |
| `verify` | `plan` | Within six minutes: polls the instances until they run the new image, then requires `/api/ready` 200, dealerships 200, `/` 200, the expected vehicle-aware flag, a byte-equal OpenAPI document and a non-empty anonymous schedule with initials, masked VIN and masked registration. Logs no response bodies |

Both build jobs delete `.cloudflare/output` and build logs with `if: always()`. No deployment artefact is uploaded.

### Repository setup and first run

1. **Resources.** Complete the prerequisites with the account owner: Neon direct endpoint, migrations and runtime role, Container application, Secrets Store secrets, Access application, custom domain and Email onboarding.
2. **Environments.** In **Settings -> Environments**, create `plan` and `production`.
   For both, under **Deployment branches and tags**, choose **Selected branches and tags** and allow branch `main` only.
   Leave `plan` without reviewers.
   In `production`, add the approver under **Required reviewers**, keep **Prevent self-review** off while there is a single approver, and disable administrator bypass.
   Check these settings in the dashboard; YAML cannot enforce them.
   [GitHub environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
3. **Inputs.** Create the tokens described under [Cloudflare token permissions](#cloudflare-token-permissions), authenticate `gh` as a repository administrator, and run the script. Supply secrets through local environment values or its hidden prompts, never as literals in history:

   ```sh
   export KEYLOOP_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
   export KEYLOOP_CONTAINER_APPLICATION_ID=<existing container application id>
   # Set the switches/identifiers below to the already approved live profile.
   # CLOUDFLARE_PLAN_API_TOKEN is a separate local input for the plan environment token.
   bash deploy/cloudflare/scripts/configure-github-environment.sh <owner>/<repo> <approver-github-login>
   ```

   The script PUTs both environments (`gh api --method PUT repos/{owner}/{repo}/environments/{environment}`), sets the approver on `production`, keeps only branch `main` in each branch policy, and sends every secret through stdin to `gh secret set --env`.
   The API cannot set administrator bypass; do that in the dashboard.
   [Environment API](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment), [branch policy API](https://docs.github.com/en/rest/deployments/branch-policies)
4. **Check.** Compare both environments with the inventory below. Rerun the script whenever approved settings change. Remove any repository-wide copies left by an earlier setup.
5. **Release.** Merge to `main`, wait for `CI`, read the plan summary and approve `production`. For a schema change, dispatch **Deploy public demo -> Run workflow -> main -> migrate=true**, approve the migration, wait for it, then approve the deployment. Write additive migrations, so the running API stays compatible in between. `verify` must pass; its failure does not roll back on its own.

### GitHub configuration inventory

Environment inputs are visible only to jobs that reference the environment ([environment secrets](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets)). Shared settings are stored in both environments; the Neon owner connection only in `production`.

| Secret in both `plan` and `production`, except where stated | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | `production`: deploy token. `plan`: separate registry/inspection token from local `CLOUDFLARE_PLAN_API_TOKEN` |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier, treated as sensitive here; derived image registry prefix |
| `KEYLOOP_SECRETS_STORE_ID` | Existing Secrets Store identifier |
| `KEYLOOP_ACCESS_AUDIENCE` | Access application AUD tags |
| `KEYLOOP_ACCESS_ADMIN`, `KEYLOOP_ACCESS_SERVICE_ADVISOR`, `KEYLOOP_ACCESS_VIEWER` | Private role lists; empty lists are allowed |
| `KEYLOOP_TRIAGE_ACCOUNT_ID`, `KEYLOOP_EMAIL_ACCOUNT_ID` | Sensitive account identifiers for enabled triage/REST email; empty while unused |
| `KEYLOOP_EMAIL_ALLOWED_ADDRESSES`, `KEYLOOP_EMAIL_ALLOWED_DOMAINS` | Private approved recipient lists; empty while notifications are disabled |
| `NEON_OWNER_CONNECTION` | **`production` only**: owner Npgsql keyword string, direct host, verified TLS and required channel binding |

| Variable in both `plan` and `production` | Default / purpose |
| --- | --- |
| `KEYLOOP_ACCESS_TEAM_DOMAIN` | Required canonical `https://<team>.cloudflareaccess.com` |
| `KEYLOOP_CONTAINER_APPLICATION_ID` | Required existing singleton application id for live verification |
| `KEYLOOP_TRIAGE_ENABLED`, `KEYLOOP_VEHICLE_AWARE_REQUIREMENTS`, `KEYLOOP_API_OTLP_ENABLED` | `false`; set only to the approved live profile |
| `KEYLOOP_NOTIFICATIONS_ENABLED`, `KEYLOOP_EMAIL_SENDING_ENABLED`, `KEYLOOP_OTLP_RELAY_ENABLED` | `false`; notifications remain disabled until the API adapter exists |
| `KEYLOOP_TRIAGE_GATEWAY_ID` | `keyloop-scheduler` |
| `KEYLOOP_TRIAGE_BUCKET` | `keyloop-scheduler-triage`; existing private R2 bucket |
| `KEYLOOP_GRAFANA_OTLP_ENDPOINT`, `KEYLOOP_GRAFANA_INSTANCE_ID` | Empty while telemetry is disabled; approved stack identifiers when enabled |
| `KEYLOOP_EMAIL_TRANSPORT` | `binding`; `rest` only by explicit selection |
| `KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY`, `KEYLOOP_EMAIL_MAX_PER_DAY` | `10`, `100`; approved caps below the account quota |

`KEYLOOP_API_IMAGE` is derived in each build job as `registry.cloudflare.com/<account id>/keyloop-scheduler-api:<12-char SHA>`; never set it in GitHub. Runtime credentials stay in Cloudflare Secrets Store (`keyloop_prod_db_url`, optional `keyloop_prod_ai_token`, `keyloop_prod_email_api_token`, `keyloop_prod_api_otlp_token`, `grafana-otlp-basic-browser`), and deployment binds references only.

### Cloudflare token permissions

Checked against Cloudflare's documentation on 2026-10-13; the first approved Actions run is the first live proof.
Scope custom tokens to this account and, for zone permissions, to `kylesmile.me`.
The dashboard calls the container capability **Containers Write** and endpoint security calls it **Workers Containers Write**; they are the same.
[Permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

| Permission | Token | Why |
| --- | --- | --- |
| Account Workers Scripts Write (or Editor scoped to the Worker) | Production | Deploy the Worker and its bindings ([Workers authorization](https://developers.cloudflare.com/workers/authorization/)) |
| Account Containers Write | Both | [Application updates](https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/edit/), [instance inspection](https://developers.cloudflare.com/api/resources/containers/subresources/applications/subresources/instances/methods/list/), and (inferred) [registry credentials](https://developers.cloudflare.com/api/resources/containers/subresources/registries/subresources/credentials/methods/generate/) for push. It can also change applications, so trusted workflows must stay protected |
| Account Settings Read | Both | CLI account and entitlement lookup (inferred) |
| Zone Workers Routes Write, `kylesmile.me` only | Production | The deploy reconciles the custom domain ([routes](https://developers.cloudflare.com/workers/authorization/workers/)) |
| Zone Read, `kylesmile.me` only | Production | CLI domain-to-zone resolution (inferred) |
| Account Secrets Store Edit | Production | Binding existing secrets needs Edit and their `workers` scope; Read fails ([Secrets Store access](https://developers.cloudflare.com/secrets-store/access-control/)) |

No R2 Write, AI Gateway Edit, AI execution, Access edit, DNS edit, Email send or Grafana permission is needed: binding an existing resource needs only Worker Editor ([bindings](https://developers.cloudflare.com/workers/authorization/#bindings)), and `--provision=false` forbids auto-provisioning.
`CLOUDFLARE_API_TOKEN` takes priority over stored OAuth in CI ([cf CI authentication](https://developers.cloudflare.com/cf/ci/)) and `CLOUDFLARE_ACCOUNT_ID` selects the account.
Node 22.23.3 and `cf` 1.0.0-beta.14 are pinned.

## Manual core profile fallback

The ordered commands for the first deployment to `keyloop.kylesmile.me`: the board, booking and Access sign-in.
Triage, email, the browser OTLP relay and API telemetry stay off; [Enable API telemetry](#enable-api-telemetry) turns the last one on afterwards.
The database is Neon Free PostgreSQL 17 in Frankfurt (AWS `eu-central-1`).
[README.md](README.md) holds the configuration contract and the reasoning.

Every step marked **REQUIRES USER CONFIRMATION** changes the Cloudflare or Neon account; run it only after the account owner confirms it. Everything else is local. `<...>` marks a value you supply; this file names no account, identifier, email address or secret.

## 0. Ground rules for this session

- Use a clean checkout of the commit you deploy, from the repository root: `export KL_SHA=$(git rev-parse --short=12 HEAD)`.
- Type every secret into a hidden prompt (`read -rs NAME`), use it only as `"$NAME"`, and `unset` it when its step is done. Never write a secret, email list or connection string as a literal in a command, file or ticket.
- `psql` takes a `postgresql://` URI with the password in `PGPASSWORD`. The migration bundle and the runtime secret take the Npgsql keyword form `Host=...;Port=5432;Database=...;Username=...;Password=...;SSL Mode=VerifyFull;Channel Binding=Require`. The API refuses a URI at startup; never give it one.
- Use Neon's **direct** endpoint host, without `-pooler` (ADR-022). The API keeps its own Npgsql pool.
- If a command fails, read its output for secrets before copying it anywhere.
- Tools: .NET SDK 10.0.100 or later, Node 22 through nvm, pnpm 12.9.1, Docker (Colima on this Mac), `jq`, `curl`, `uuidgen`, and `psql` from `brew install libpq` (then `export PATH="$(brew --prefix libpq)/bin:$PATH"`).
  The `postgres:17` image also works, `alias psql='docker run --rm -it -e PGPASSWORD -v "$PWD/deploy/neon:/repo/deploy/neon:ro" -w /repo postgres:17 psql'`, but it has no CA bundle: replace `sslmode=verify-full&sslrootcert=system` below by `sslmode=require` (encrypted, certificate not verified).
- The `cf` CLI is pinned in this project:

```sh
cd deploy/cloudflare
source ~/.nvm/nvm.sh && nvm use 22
npm ci --no-audit --no-fund
export CF_SEND_TELEMETRY=false WRANGLER_SEND_METRICS=false
alias cf="$PWD/node_modules/.bin/cf"
cd ../..
```

Run `--dry-run` first whenever a `cf` command offers it. If your login sees several accounts, set `CLOUDFLARE_ACCOUNT_ID` for the session.

## 1. Neon: database, migrations and the runtime role

1. **REQUIRES USER CONFIRMATION:** create the Neon Free project on PostgreSQL 17 in AWS Frankfurt (`eu-central-1`, the nearest EU region Neon offers), the database `keyloop_scheduler` owned by the owner role, and compute fixed at 0.25 CU (autoscaling minimum and maximum both 0.25). Scale to zero stays on.

2. Enter the connection parts:

```sh
read -r  NEON_HOST       # direct endpoint host, without -pooler
read -r  NEON_OWNER      # the owner role's name
read -rs NEON_OWNER_PW   # the owner role's password (hidden)
```

3. Build the migration bundle, a self-contained macOS arm64 executable of about 160 MB under the ignored `artifacts/` directory, and list its inventory offline:

```sh
dotnet tool restore
dotnet restore src/Keyloop.ServiceScheduler.Api   # a fresh checkout has no restored assets for dotnet ef to read
KEYLOOP_BUILD_MIGRATION_BUNDLE=true dotnet ef migrations bundle --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api --configuration Release \
  --self-contained --target-runtime osx-arm64 --output artifacts/keyloop-efbundle-osx-arm64 --force
```

```sh
dotnet ef migrations list --no-connect --no-build --configuration Release \
  --project src/Keyloop.ServiceScheduler.Infrastructure --startup-project src/Keyloop.ServiceScheduler.Api
```

4. **REQUIRES USER CONFIRMATION:** apply the migrations as the owner. The string is assembled from variables, so it never reaches shell history; local `ps` can see it for the few seconds the bundle runs.

```sh
export KEYLOOP_OWNER_CONN="Host=$NEON_HOST;Port=5432;Database=keyloop_scheduler;Username=$NEON_OWNER;Password=$NEON_OWNER_PW;SSL Mode=VerifyFull;Channel Binding=Require"
./artifacts/keyloop-efbundle-osx-arm64 --connection "$KEYLOOP_OWNER_CONN"
unset KEYLOOP_OWNER_CONN
```

The bundle applies every inventory entry missing from `__EFMigrationsHistory`, in order, then prints `Done.`; a second run applies nothing.
To see what is pending first, run the list command without `--no-connect` and with `--connection "$KEYLOOP_OWNER_CONN"`.
Apply everything before a newer image serves traffic: the API runs with `Database__MigrateOnStartup=false`, and the verifier requires schema readiness.

5. **REQUIRES USER CONFIRMATION:** create the runtime role **with SQL**. A role made in the Neon Console, CLI or API joins `neon_superuser`, and `runtime-role.sql` refuses it; delete such a `scheduler_app` first. Paste the generated password at both hidden `\password` prompts:

```sh
export PGPASSWORD="$NEON_OWNER_PW"
export KEYLOOP_OWNER_URI="postgresql://$NEON_OWNER@$NEON_HOST/keyloop_scheduler?sslmode=verify-full&sslrootcert=system"
KL_APP_PW="$(openssl rand -hex 32)"
printf '%s' "$KL_APP_PW" | pbcopy
psql "$KEYLOOP_OWNER_URI" -v ON_ERROR_STOP=1 -c 'CREATE ROLE scheduler_app LOGIN'
psql "$KEYLOOP_OWNER_URI" -c '\password scheduler_app'
pbcopy < /dev/null
```

6. **REQUIRES USER CONFIRMATION:** grant DML only. The script checks the role is a plain login role with no memberships, then grants and verifies in one transaction. Run it again after every future migration bundle.

```sh
psql "$KEYLOOP_OWNER_URI" -v ON_ERROR_STOP=1 -f deploy/neon/runtime-role.sql
```

Expected: `NOTICE: scheduler_app: explicit runtime grants, append-only audits/policies, no appointment DELETE, no default grants or DDL`, then `COMMIT`. The grant matrix:

- Audit tables and immutable policies: SELECT and INSERT only.
- Appointments, bays, technicians and the outbox: also UPDATE.
- Idempotency keys only: DELETE, for expiry replacement.
- Reference catalogue: INSERT, for startup seeding.

New tables need explicit grants after migration. Actions also runs `deploy/neon/verify-runtime-role.sql`, which asserts both required and forbidden privileges.

7. Check from the runtime role's side that it can read but not change the schema:

```sh
PGPASSWORD="$KL_APP_PW" psql "postgresql://scheduler_app@$NEON_HOST/keyloop_scheduler?sslmode=verify-full&sslrootcert=system" \
  -c 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId"' -c 'CREATE TABLE public.ddl_probe (id int)'
```

Expected: the inventory's migration IDs, then `ERROR: permission denied for schema public`.

8. Keep `KL_APP_PW` and `NEON_HOST` for step 2.3, then: `unset PGPASSWORD NEON_OWNER_PW KEYLOOP_OWNER_URI NEON_OWNER`.

## 2. Cloudflare login and Secrets Store

1. Log in (opens the browser): `cf auth login`.
2. **REQUIRES USER CONFIRMATION:** the Secrets Store. Reuse the account's store if `cf secrets-store stores list` shows one; otherwise create it in the dashboard or with `npx wrangler secrets-store store create keyloop-scheduler --remote` (`cf` has no create command). Then `export KEYLOOP_SECRETS_STORE_ID=<store id>`.
3. **REQUIRES USER CONFIRMATION (the account owner enters the value):** the secret `keyloop_prod_db_url` with scope `workers`. Paste it from the clipboard into the dashboard (preferred) or Wrangler's prompt. Never use `cf secrets-store secrets create --body` or Wrangler's `--value`, which take the secret as an argument.

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

1. Team domain: read `auth_domain` from `cf zero-trust organization get`. If there is no Zero Trust organisation, create it in the dashboard (**REQUIRES USER CONFIRMATION**). Then `export KEYLOOP_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com`.
2. One-time PIN: if `cf zero-trust identity-providers list` shows no `"type": "onetimepin"` provider, **REQUIRES USER CONFIRMATION:**

```sh
cf zero-trust identity-providers create --body "$(cat deploy/cloudflare/build/access/identity-provider-otp.json)"
```

Note the provider's `id`. No other identity provider is added.

3. **REQUIRES USER CONFIRMATION:** the Allow policy. Replace the `__REVIEWER_EMAIL_n__` placeholders in `build/access/policy-reviewers.template.json` with the approved emails (a whole domain is `{ "email_domain": { "domain": "<domain>" } }`). Allow everyone in a role list of step 6, plus one email in no role list for the 403 rehearsal. Never use an unrestricted PIN rule or a Bypass policy.

```sh
cf zero-trust access policies create --body "$(cat deploy/cloudflare/build/access/policy-reviewers.template.json)"
```

Note the policy `id`.

4. **REQUIRES USER CONFIRMATION:** the application. Replace `__ONE_TIME_PIN_IDP_ID__` and `__REVIEWERS_POLICY_ID__` in `build/access/application.template.json`. The body selects:

- self-hosted on `keyloop.kylesmile.me/auth/*` only; the board, assets and `/api/v1/*` stay public at Access;
- a one-hour session, short on purpose because the API validates the token offline until it expires; the web app renews it through the 24-hour Access account session (ADR-027);
- one-time PIN as the only IdP, with automatic redirect;
- Cookie Path Attribute **disabled** (`path_cookie_attribute: false`, so the cookie reaches `/api/v1/*`), `HttpOnly`, `SameSite=Lax`, binding cookie off, hidden from the App Launcher.

```sh
cf zero-trust access applications create --body "$(cat deploy/cloudflare/build/access/application.template.json)"
```

5. Read `aud` from `cf zero-trust access applications get <application id>` and `export KEYLOOP_ACCESS_AUDIENCE=<aud>`. It is an identifier, not a credential.

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

Expected: `amd64` and the `tini` entrypoint, `status 134` within seconds (124 means it hangs), and all edge checks pass. `DOTNET_EnableWriteXorExecute=0` only lets the amd64 image run under emulation on Apple silicon; it is never part of the deployment.

## 5. Push the API image

**REQUIRES USER CONFIRMATION:**

```sh
cf containers push --tag "keyloop-scheduler-api:$KL_SHA" --dry-run
cf containers push --tag "keyloop-scheduler-api:$KL_SHA"
cf containers images list
```

Then `export KEYLOOP_API_IMAGE=registry.cloudflare.com/<account id>/keyloop-scheduler-api:<KL_SHA>`, the pushed reference.

## 6. Build the edge with the real identifiers

The role lists are typed privately, so they reach neither history nor the repository:

```sh
export KEYLOOP_NOTIFICATIONS_ENABLED=false KEYLOOP_EMAIL_SENDING_ENABLED=false
export KEYLOOP_OTLP_RELAY_ENABLED=false KEYLOOP_TRIAGE_ENABLED=false KEYLOOP_API_OTLP_ENABLED=false KEYLOOP_EMAIL_TRANSPORT=binding
export KEYLOOP_VEHICLE_AWARE_REQUIREMENTS=false
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

Check before going on:

- domain `keyloop.kylesmile.me`, `workersDev` and `previewUrls` false, no triggers;
- `DB_URL` is `secret:keyloop_prod_db_url`; `API_IMAGE`, `AUTH_TEAM_DOMAIN` and `AUTH_AUDIENCE` are yours;
- no `EMAIL_API_TOKEN`, `GRAFANA_OTLP_BASIC_BROWSER`, `API_OTLP_TOKEN`, `AI_TOKEN` or `TRIAGE_IMAGES` binding;
- `NOTIFICATIONS_ENABLED`, `EMAIL_SENDING_ENABLED`, `OTLP_RELAY_ENABLED`, `API_OTLP_ENABLED`, `TRIAGE_ENABLED` and `VEHICLE_AWARE_REQUIREMENTS` are `false`;
- the container is `basic`, one instance, `WEUR`, with your pushed image.

`.cloudflare/` is ignored and holds the role lists in plain text; do not share it.

## 7. Deploy

**REQUIRES USER CONFIRMATION:** inspect the plan, then deploy exactly what was built. `--provision=false` stops the deployment creating any resource it was not given.

```sh
cf deploy --prebuilt --provision=false --dry-run
cf deploy --prebuilt --provision=false --message "core profile $KL_SHA"
```

This creates the Worker `keyloop-scheduler`, its `ApiContainer` Durable Object class and Container application, and the Custom Domain `keyloop.kylesmile.me` with its DNS record and certificate.
The first API request creates the Durable Object `api` with the `weur` hint and cold-starts the container.
If the plan says the `EMAIL` binding needs Email onboarding on the zone, stop: onboarding is a separate decision.

## 8. Redirect HTTP to HTTPS

**REQUIRES USER CONFIRMATION**, one of:

- Zone-wide: `cf zones settings edit always_use_https --zone kylesmile.me --body '{"value":"on"}'`. This redirects every hostname in the zone.
- This hostname only, with a Single Redirect rule.
  Find the zone's `http_request_dynamic_redirect` entrypoint with `cf rulesets list --zone kylesmile.me` and add the rule with `cf rulesets rules create <ruleset id> --zone kylesmile.me --body "$(cat <rule file>)"`.
  If it does not exist, create it with `cf rulesets create --zone kylesmile.me --kind zone --phase http_request_dynamic_redirect --name default --rules '[<rule>]'`.
  Never replace an existing entrypoint; that drops its other rules.
  The rule:

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

The static assets already send host-only HSTS (`public/_headers`).

## 9. Rehearsal

Run from the repository root with `H=https://keyloop.kylesmile.me` and `READING=$(curl -sS "$H/api/v1/dealerships" | jq -r '.[] | select(.name == "Keyloop Motors Reading") | .id')`. Any failure stops the rollout; the README's Access checklist (items 7 to 9) is the source of each check.

1. **Cold start under 60 s**, right after the deploy or after 30 idle minutes: `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$H/api/v1/dealerships"` returns `200`.
   A `503 service-unavailable` means the container did not start or could not be reached; check the Container and Worker logs.
   After a configuration change the first request can also wait up to 20 s for the old container to stop ([Later configuration changes](#later-configuration-changes)).
2. **HTTPS and HSTS:** `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://keyloop.kylesmile.me/board` gives `301 https://keyloop.kylesmile.me/board`; `curl -sSI "$H/" | grep -i strict-transport-security` gives `max-age=31536000`.
3. **Readiness and the public surface.**
   - `curl -sS -o /dev/null -w '%{http_code}\n' "$H/api/ready"` returns `200`. A `503` means connectivity, pending migrations or transport. GET and HEAD return no body and `Cache-Control: no-store`; other methods return 405. The container's `/alive` is only a process probe.
   - `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n'` on `$H/health` and `$H/alive` answers from Static Assets (the SPA, or a plain 404 for a non-navigation), never with API JSON. `curl -sS -X POST -o /dev/null -w '%{http_code}\n' "$H/api/v1/admin/demo/reseed"` gives `404`.
   - `curl -sS "$H/scalar/v1" | grep -c 'src="/scalar/standalone.js"'` gives `1`, and `curl -sS "$H/openapi/v1.json" | cmp - contracts/openapi/v1.json` prints nothing ([static API reference](README.md#static-api-reference)).
   - In a browser, `$H/scalar/v1` renders the operations with no Content Security Policy error and requests to this hostname only; "Test Request" on "List dealerships" answers `200`.
4. **Signed-out reads are masked:** `curl -sS "$H/api/v1/dealerships/$READING/schedule?date=<open weekday>" | jq '.. | objects | select(has("customerName")) | {customerName, vin, registration}' | head`. Names are initials, VINs show the last six characters, registrations are `*******`, and no email or phone appears. `curl -sS "$H/api/v1/me"` gives `"authenticated": false`.
5. **Each role**, in a private window per person: open `$H/auth/login?returnTo=%2Fboard`, sign in with the PIN, land on `/board`, and check `$H/api/v1/me` shows the role. ServiceAdvisor and Admin can book and cancel; a Viewer sees full names and details but cannot book, and the UI says why.
6. **No role:** an allowed email in no role list signs in with `"roles": []`, and the board shows booking unavailable with the reason. The script in item 8 stops with `roles=[]`; the API answers such a write with 403.
7. **Sign out** at `$H/cdn-cgi/access/logout`: the hostname's `CF_Authorization` cookie is gone, `/api/v1/me` is anonymous, reads are masked and writes answer 401.
8. **The 30-way booking:** sign in as a ServiceAdvisor, copy the `CF_Authorization` cookie value from the developer tools, and run the script. It reads the value without echoing it, books one single-capacity slot 30 times at once and cancels the winner.

```sh
deploy/cloudflare/scripts/rehearse-contention.sh "$H"
```

Expected: `201: 1   409: 29   other: 0` and `PASS`. The k6 profiles in `tests/load/k6` carry no Access identity, so they cannot write to this deployment.

9. **Clean up:** `unset NEON_HOST KEYLOOP_ACCESS_ADMIN KEYLOOP_ACCESS_SERVICE_ADVISOR KEYLOOP_ACCESS_VIEWER` and delete `deploy/cloudflare/build/access/`.

## Container unavailability during a rollout

A rollout can stop the outgoing container mid-request.
The Worker then answers `503 Service Unavailable` as `application/problem+json` with type `https://api.keyloop.example/problems/service-unavailable`, `Retry-After: 3`, `Cache-Control: no-store`, and a `traceId` echoed as `X-Request-Id`.
Only a rejected GET or HEAD retries once, after 150 ms; writes never retry.
Any response the API produced, a 500 included, passes through unchanged.
One `ApiUnavailable` log line records the exhaustion, without exception text, body, URL or personal data.

What to do:

- A short `service-unavailable` window is normal hand-over: wait three seconds and repeat a read.
- Persistent 503s: check Container readiness, configuration, Secrets Store and rollout state. An API `500 internal-error` needs API diagnosis.
- Never replay a write from an operator script. The web app retries reads once and offers *Try again* on writes; a booking retry keeps its body and idempotency key.
- The Actions verifier requires `/api/ready` 200 as well as public reads, so a missing migration fails verification even when reads work.

Offline proof: `npm test -- test/unavailable.test.ts test/router.test.ts test/container.test.ts`.

## Later configuration changes

A running container keeps the environment it started with.
On the first API request after each deploy, the Durable Object compares a fingerprint of the configuration it would use now with the one it last started, and restarts the container when they differ ([README](README.md#configuration-changes-and-container-restarts)).
To change a setting, for example `KEYLOOP_VEHICLE_AWARE_REQUIREMENTS=true` or enabling triage:

1. Set the changed variables with the others from step 6, run `npm run build`, and check the bindings as in step 6.
2. **REQUIRES USER CONFIRMATION:** deploy as in step 7.
3. Send one API request, as in rehearsal item 1. It waits for the old container to stop (up to 15 s after SIGTERM, then 5 s after a kill) and the new one to start. On a `503 service-unavailable`, wait three seconds and repeat; a failed stop keeps the old fingerprint and the next request retries.
4. In the Worker logs, confirm one `ApiContainerRestart` event with reason `configuration-changed` (or `unrecorded` the first time). No event means no running container had to be replaced, because it was already current or asleep.
5. Check the effect. Triage: describing an issue in the booking dialog returns suggestions instead of the `503 triage-unavailable` fallback. Vehicle-aware booking: `curl -sS "$H/api/v1/features"` gives `{"vehicleAwareRequirements":true}`, and the booking dialog shows the vehicle step.

## Enable API telemetry

This turns on the API's OTLP export of traces, metrics and logs to Grafana Cloud on a running deployment. The committed dashboards select `job="keyloop-scheduler/api"` and environment `Production`, which this export produces; the container variables are listed in the [README](README.md#optional-api-telemetry). Step 0 still applies.

1. **REQUIRES USER CONFIRMATION (account owner, Grafana Cloud):**
   - Read the OTLP endpoint (`https://otlp-gateway-<region>.grafana.net/otlp`) and the numeric instance ID from the stack's **OpenTelemetry** tile. Both are identifiers.
   - Create an access policy for this stack only with `metrics:write`, `logs:write` and `traces:write`, and one token on it, for example `keyloop-scheduler-api`. Grafana shows it once; it never goes into chat, a ticket, a file or a command line.
2. **REQUIRES USER CONFIRMATION (account owner, Cloudflare):** store the token in Secrets Store `keyloop` as `keyloop_prod_api_otlp_token`, scope **Workers**, in the dashboard or through a hidden prompt (`printf` is a builtin, so the token reaches neither history nor the process list):

```sh
export KEYLOOP_SECRETS_STORE_ID=<id of the keyloop store>   # cf secrets-store stores list
read -rs KL_API_OTLP_TOKEN                                  # paste the Grafana token, then Enter; nothing is echoed
printf '%s' "$KL_API_OTLP_TOKEN" | (cd deploy/cloudflare && npx wrangler secrets-store secret create "$KEYLOOP_SECRETS_STORE_ID" \
  --name keyloop_prod_api_otlp_token --scopes workers --remote)
unset KL_API_OTLP_TOKEN
```

Expected: `Creating secret... (Name: keyloop_prod_api_otlp_token, Value: REDACTED, Scopes: workers, ...)`.

3. Build and check the API image as in [step 4](#4-local-builds-and-checks). **REQUIRES USER CONFIRMATION:** push it as in [step 5](#5-push-the-api-image) and export `KEYLOOP_API_IMAGE`. Its `appsettings.Production.json` keeps per-SQL-command and per-HTTP-request logs out of Loki.
4. Build the edge as in [step 6](#6-build-the-edge-with-the-real-identifiers) with the live settings plus:

```sh
export KEYLOOP_API_OTLP_ENABLED=true
export KEYLOOP_GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp   # from the OpenTelemetry tile, no trailing slash
export KEYLOOP_GRAFANA_INSTANCE_ID=<instance id>                                     # digits only
```

`KEYLOOP_OTLP_RELAY_ENABLED` stays `false`. A malformed endpoint or instance ID fails `npm run build` with the setting's name. Expect `API_OTLP_TOKEN` as `secret:keyloop_prod_api_otlp_token`, `API_OTLP_ENABLED` `true`, and your endpoint and instance ID; everything else as in step 6.

5. **REQUIRES USER CONFIRMATION:** deploy as in [step 7](#7-deploy) with `--message "api telemetry $KL_SHA"`; the dry run shows the new version, three new bindings and the new image.
   Then `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$H/api/v1/dealerships"` must answer `200`, restarting the container with the telemetry settings (one `ApiContainerRestart` event).
   A missing or malformed token refuses the start with a Worker log message naming only the secret.
6. **REQUIRES USER CONFIRMATION:** push the Grafana folder and dashboards with an authenticated `gcx` context ([observability README](../../observability/grafana/README.md#pushing-to-grafana)); an unchanged set reports no change:

```sh
gcx resources push --context default -p observability/grafana/folders -p observability/grafana/dashboards --dry-run
gcx resources push --context default -p observability/grafana/folders -p observability/grafana/dashboards --on-error abort
```

7. Verify read-only in Grafana Explore after two or three minutes of traffic (metrics export every 60 s):
   - Metrics: `count by (job, service_namespace, service_name) (http_server_request_duration_seconds_count{job="keyloop-scheduler/api"})` shows the job, and `count by (deployment_environment_name) (target_info{job="keyloop-scheduler/api"})` shows `Production`.
   - Logs: `{service_namespace="keyloop-scheduler", service_name="api"}` has startup event `1102` and no `Executed DbCommand` records.
   - Traces: `{ resource.service.namespace = "keyloop-scheduler" && resource.service.name = "api" }` finds the request's server span.
   - The API health and Booking engine dashboards fill as requests arrive.

   The container log never shows export failures. If nothing arrives, check the token's realm and scopes, the instance ID and the endpoint's region.

While telemetry is on, the backlog gauges query the database every export, so Neon stays awake while the container runs; watch the Free plan's compute hours.

**Disable:** export `KEYLOOP_API_OTLP_ENABLED=false`, rebuild and deploy. **Rotate:** add a new token to the policy, replace the secret's value (dashboard, or `npx wrangler secrets-store secret update "$KEYLOOP_SECRETS_STORE_ID" --secret-id <id> --remote` with the same `read -rs` and `printf` pattern), redeploy, send one API request, then delete the old token in Grafana.

## Rollback

- **API image:** push the previous tag if the registry no longer has it, set `KEYLOOP_API_IMAGE`, rebuild (step 6) and deploy (step 7). The image is part of the fingerprint, so the first API request restarts the container on it; confirm the `ApiContainerRestart` event.
- **A setting:** restore the previous value, rebuild and deploy, as in [Later configuration changes](#later-configuration-changes).
- **A bad secret** (`keyloop_prod_db_url`, `keyloop_prod_ai_token` or `keyloop_prod_api_otlp_token`): replace it in Secrets Store, then **REQUIRES USER CONFIRMATION:** `cf deploy --prebuilt --provision=false --message "rotate secret"` with the existing build output (rebuild as in step 6 if it is gone).
  The first API request after the deploy restarts the container with the new value.
  Without a deploy it applies only at the container's next start.
- **Neon** restores within its six-hour Free history window. Access application and policy changes are reversible in the dashboard.

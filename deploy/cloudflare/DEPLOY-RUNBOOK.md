# Public demo deployment runbook

## Deploy from GitHub Actions

Task 35 (stakeholder decision, 2026-10-13) moves routine releases to [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml), with the stakeholder approving the `production` environment. The manual core-profile instructions below remain the first-resource/bootstrap and break-glass fallback. CI in `ci.yml` is unchanged.

Both `workflow_dispatch` and `workflow_run` require this workflow file on the repository's default branch. Use `main` as that branch. A successful `CI` push run on `main` plans its exact `head_sha`; a manual run must select `main` and prove that exact SHA already passed push CI. Fork/PR completions, other CI event types and failed CI do not plan. Current-main checks before planning, migration and deployment refuse commits superseded while queued or awaiting review, preventing a delayed approval from rolling back a newer commit. Keep main protected and review workflow/configuration changes before merging. Both environments restrict access to branch `main`; build inputs belong to the `plan` environment, with no repository-wide copies.

The job graph is `plan -> [migrate, if manually requested] -> deploy -> verify`; `deploy` explicitly accepts a skipped migration and refuses a failed or cancelled one. `deploy-production` concurrency keeps one run active, with `cancel-in-progress: false` so an active migration/deploy is never interrupted by a newer run. GitHub may replace an older pending run with a newer pending one. All jobs use disposable Ubuntu runners. Global token permissions are `contents: read`; only `plan` adds `actions: read` to check manual dispatch's CI evidence and confirm that `production` has a non-empty required-reviewer rule before publishing the build image. The controller must still select the stakeholder and disable bypass in repository settings.

- `plan`, main-only `plan` environment without reviewers: native `linux/amd64` API build, immutable 12-character SHA tag, `cf containers push` to the managed registry, same-origin SPA build with OTEL/API-base overrides unset, edge build and `cf deploy --prebuilt --provision=false --dry-run`. Pushing this build image does not roll out an application. Its summary shows the SHA, tag, container policy and the dry run's binding resource labels, with values/account identifiers removed. Build variables are evaluated in the build step after the runner declares the environment, so the push runs outside the project directory (cf would otherwise evaluate `cloudflare.config.ts` without them). A failing cf step prints its error with email addresses, hexadecimal identifiers and token-like strings removed (`scripts/print-redacted-error.sh`).
- `migrate`, protected `production`, manual `migrate=true` only: restore pinned `dotnet-ef` from `.config/dotnet-tools.json`, build a self-contained `linux-x64` bundle, apply pending migrations as the Neon owner, then reapply and verify `deploy/neon/runtime-role.sql`. Reruns apply only pending migrations and repeat idempotent grants. The runtime role must already exist, created with SQL as described below. Bundle builds set `KEYLOOP_BUILD_MIGRATION_BUNDLE=true` to skip OpenAPI generation for the self-contained target (the document loader cannot load it); ordinary builds/CI still generate and compare the contract. The small `deploy/neon/github-migrate` tool uses Npgsql's keyword parser (including quoted passwords), requires direct-host `SSL Mode=VerifyFull;Channel Binding=Require`, gives `psql` equivalent libpq TLS/channel-binding environment settings, and withholds child output on failure. It never echoes the connection. The bundle's connection is briefly a child process argument on the isolated runner, as in the manual path.
- `deploy`, protected `production`: rebuild the SPA and edge for the planned SHA, then deploy its own output with `--prebuilt --provision=false --message "<sha> via GitHub Actions run <run_id>"`. Each protected job can require a separate approval. No bundle or `.cloudflare/output` crosses job boundaries.
- `verify`, main-only `plan` environment, after deployment: curl without cookies and with a normal browser user agent wakes the API, polls actual active instances for the new image and running status, requires dealerships 200 afterwards, and checks `/` 200, the expected vehicle-aware feature flag, byte-equal committed OpenAPI, and a non-empty seeded anonymous schedule with initials, masked VIN and fully masked registration. Empty schedules do not prove masking. All network/rollout checks share a six-minute deadline; failure fails the run. No smoke response bodies are logged or uploaded.

Private `.cloudflare/output` and build logs are removed with `if: always()` in both build jobs, including failed builds. No deployment artefact is uploaded. A forcibly terminated runner can skip cleanup; it is disposable, and its filesystem is never published.

### Controller setup and first run

1. Complete the existing resource prerequisites with the stakeholder: Neon direct endpoint, migrations/runtime role, Cloudflare Container application, Secrets Store scoped secrets, Access application, custom domain and Email binding onboarding. For a migration-requiring release, choose manual `migrate=true` before approving a deploy; automatic runs do not migrate. Reject/cancel the automatically queued deployment if its schema is not ready, then dispatch the migration run. Use additive migrations that leave the previous API compatible while migration and deployment are separately approved.
2. In GitHub **Settings -> Environments -> New environment**, create exactly `plan` and `production`. For both, under **Deployment branches and tags**, select **Selected branches and tags**, add branch `main` only, and remove all other branch/tag allowances. Leave `plan` without required reviewers or a wait timer. In `production`, add the stakeholder under **Required reviewers** and save. Keep **Prevent self-review** off for this single-reviewer demo so the stakeholder can dispatch and then approve; enable it only with another authorized initiator/reviewer available. Disable administrator bypass of production protection rules. Required reviewers are supported for this public repository on GitHub Free. Verify both environments' branch policies and production's reviewer rule before enabling deployment, since YAML alone cannot enforce them. [GitHub environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
3. Create scoped Cloudflare API tokens as below. Authenticate `gh` with a controller account able to administer this repository's environment and set its secrets/variables. Set the non-sensitive variables locally, and supply secrets through local environment values the controller already holds or the script's hidden prompts. Do not put literal credentials/role lists into history. The script makes GitHub writes, so only the authorized controller runs it:

   ```sh
   export KEYLOOP_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
   export KEYLOOP_CONTAINER_APPLICATION_ID=<existing container application id>
   # Set the switches/identifiers below to the already approved live profile.
   # CLOUDFLARE_PLAN_API_TOKEN is a separate local input for the plan environment token.
   bash deploy/cloudflare/scripts/configure-github-environment.sh <owner>/<repo> <stakeholder-github-login>
   ```

   The script uses `gh api --method PUT repos/{owner}/{repo}/environments/{environment} --input -` for both environments, with no reviewers for `plan` and the numeric stakeholder reviewer for `production`. It adds branch `main` if absent and deletes all other branch/tag policies, including a tag named `main`. It sends each secret through stdin to `gh secret set --env plan` or `--env production`, never `--body`/arguments, and disables shell tracing and `GH_DEBUG`. The PUT API supports reviewers/self-review/branch policy but does not expose the administrator-bypass checkbox; set that in the dashboard. [GitHub environment API](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment), [branch policy API](https://docs.github.com/en/rest/deployments/branch-policies)
4. Check both environments' own inputs against the complete inventory below. Rerun the script when approved settings change to keep shared settings synchronized. If repository copies were installed by an earlier setup, remove every listed secret and variable from **Settings -> Secrets and variables -> Actions** after confirming the environment inputs. No repository copies are used or written by this workflow/setup. Inspect both main-only policies and production's reviewer rule in the dashboard after setup. Each environment has its own `CLOUDFLARE_API_TOKEN`: `plan` uses the separate registry/inspection token and `production` uses the deploy token.
5. Merge the reviewed changes onto default `main` through the controller's normal process, wait for `CI` to pass, then inspect the plan summary and approve `production`. For schema changes, dispatch **Deploy public demo -> Run workflow -> main -> migrate=true**, approve migration, wait for its success, then approve deployment. The final `verify` job must pass; its failure does not silently roll back. This implementation performs no live deployment or account setup.

### GitHub configuration inventory

[GitHub environment inputs](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets) are available only to jobs referencing that environment. `plan` and `verify` reference main-only `plan`, without required reviewers; `migrate` and `deploy` reference main-only `production`, with stakeholder review. All shared build settings are stored separately in these environments, never as repository-wide copies. The Neon owner connection stays exclusively in `production`. `plan`'s `CLOUDFLARE_API_TOKEN` uses the separate local `CLOUDFLARE_PLAN_API_TOKEN`; production's value uses the deploy token. Private role/recipient lists stay environment secrets. [Environment configuration variables](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#vars-context) are read in runner steps after the environment is declared.

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

`KEYLOOP_API_IMAGE` is derived separately in each build job as `registry.cloudflare.com/<account id>/keyloop-scheduler-api:<12-char SHA>`; never set it in GitHub. Database/AI/email/OTLP credential values stay in Cloudflare Secrets Store (`keyloop_prod_db_url`, optional `keyloop_prod_ai_token`, `keyloop_prod_email_api_token`, `keyloop_prod_api_otlp_token`, `grafana-otlp-basic-browser`); deployment binds references only. `NEON_OWNER_CONNECTION` is the migration owner's separate credential, not the runtime database secret.

### Cloudflare token permissions

Checked against official documentation on 2026-10-13, not exercised against the live account. Use custom tokens scoped to this account and, for zone permissions, only `kylesmile.me`. `cf` beta names can differ between the dashboard and API: the permission reference calls the account capability **Containers Write**, while endpoint security lists **Workers Containers Write**. Select the matching account Containers edit/write capability; do not grant unrelated account permissions. [Permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

| Permission | Token | Evidence / confidence |
| --- | --- | --- |
| Account Workers Scripts Write (or Editor scoped to the existing Worker) | Production | Verified in [Workers authorization](https://developers.cloudflare.com/workers/authorization/): deploy existing Worker and resource bindings |
| Account Containers Write / Workers Containers Write | Both | Verified for [application updates](https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/edit/) and [instance inspection](https://developers.cloudflare.com/api/resources/containers/subresources/applications/subresources/instances/methods/list/). Required for registry credential generation/push is inferred from [registry credentials](https://developers.cloudflare.com/api/resources/containers/subresources/registries/subresources/credentials/methods/generate/), registry API security and the pinned CLI implementation; the credentials request restricts its managed-registry JWT to push/pull. There is no separately documented registry-only API token permission. This broad Containers capability can also change applications; protect trusted main workflows accordingly |
| Account Settings Read | Both | Permission existence verified in the reference; inclusion for CLI account/entitlement lookup is inferred. Account selection is explicit |
| Zone Workers Routes Write, zone `kylesmile.me` only | Production | Verified for changing routes/custom domains in [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/). Existing unchanged domain connections need only Worker Editor, but the pinned deployment reconciles the configured domain, so retain this zone capability for this pipeline |
| Zone Read, zone `kylesmile.me` only | Production | Existence verified in the reference; needed for beta CLI domain-to-zone resolution is inferred |
| Account Secrets Store Edit (API may label it Secrets Store Write) | Production | Verified in [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/): binding existing secrets still requires Edit and their `workers` scope; Read alone fails |

Do not grant R2 Write or AI Gateway Edit just to deploy: [Workers bindings authorization](https://developers.cloudflare.com/workers/authorization/#bindings) says binding existing resources needs Worker Editor, without separate permissions on those resources. Here `--provision=false` forbids auto-provisioning; R2 is an existing binding and AI Gateway id/account are text settings, not a gateway-management operation. No deploy-time AI token, Workers AI execution permission, Access edit, DNS edit, Email send or Grafana permission is requested. If the pinned beta CLI reports an additional metadata lookup requiring R2 Read, that would be an unverified CLI-specific requirement to diagnose on the first controller run, not a reason to grant resource write access in advance. The separate runtime AI token and optional runtime email token retain their existing scopes.

[cf CI authentication](https://developers.cloudflare.com/cf/ci/) and [unattended agents](https://developers.cloudflare.com/cf/agents/#authenticate-unattended-agents) explicitly confirm that `CLOUDFLARE_API_TOKEN` takes priority over stored OAuth, with no interactive login in CI; `CLOUDFLARE_ACCOUNT_ID` selects the account. Node 22.23.3 and `cf` 1.0.0-beta.14 remain pinned. No OAuth file is used or copied. The first real token-scope/registry/rollout proof belongs to the controller's approved Actions run.

## Manual core profile fallback

This is the ordered command list for the first deployment of the scheduler to `keyloop.kylesmile.me`: the board, booking and Access sign-in. Intake triage, email, the browser OTLP relay and API telemetry stay off; [Enable API telemetry](#enable-api-telemetry) turns the last on afterwards. The database is Neon Free PostgreSQL 17 in Frankfurt (AWS `eu-central-1`). [README.md](README.md) holds the configuration contract and the reasoning; this file only orders the work.

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

1. **REQUIRES USER CONFIRMATION (stakeholder):** the Neon Free project on PostgreSQL 17 in AWS Frankfurt (`eu-central-1`; London `eu-west-2` was planned but not offered, so pick the nearest EU region Neon offers), the database `keyloop_scheduler` owned by the owner role, and compute fixed at 0.25 CU (autoscaling minimum and maximum both 0.25). Scale to zero stays on.

2. Enter the connection parts (hidden where secret):

```sh
read -r  NEON_HOST       # direct endpoint host, without -pooler
read -r  NEON_OWNER      # the owner role's name
read -rs NEON_OWNER_PW   # the owner role's password (hidden)
```

3. Build the migration bundle locally. It is a self-contained macOS arm64 executable of about 160 MB under the ignored `artifacts/` directory; never commit it.

```sh
dotnet tool restore
dotnet restore src/Keyloop.ServiceScheduler.Api   # a fresh checkout has no restored assets for dotnet ef to read
KEYLOOP_BUILD_MIGRATION_BUNDLE=true dotnet ef migrations bundle --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api --configuration Release \
  --self-contained --target-runtime osx-arm64 --output artifacts/keyloop-efbundle-osx-arm64 --force
```

4. **REQUIRES USER CONFIRMATION:** apply the migrations as the owner. The connection string is assembled from the variables, so neither the password nor the string reaches the shell history. It is visible to local `ps` for the few seconds the bundle runs.

```sh
export KEYLOOP_OWNER_CONN="Host=$NEON_HOST;Port=5432;Database=keyloop_scheduler;Username=$NEON_OWNER;Password=$NEON_OWNER_PW;SSL Mode=VerifyFull;Channel Binding=Require"
./artifacts/keyloop-efbundle-osx-arm64 --connection "$KEYLOOP_OWNER_CONN"
unset KEYLOOP_OWNER_CONN
```

Expected: six `Applying migration '...'` lines and `Done.` on an empty database; on a database that already has the first five (a deployment made before Task 30a), only `20261012204715_AdminEditing`. A second run applies nothing. Apply it before an image built from a later commit serves traffic: the API runs with `Database__MigrateOnStartup=false`.

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

Expected: `NOTICE: scheduler_app: DML on 12 application tables, read-only migration history, no DDL`, then `COMMIT`.

7. Check from the runtime role's side, with the password still in `KL_APP_PW`, that it can read but cannot change the schema:

```sh
PGPASSWORD="$KL_APP_PW" psql "postgresql://scheduler_app@$NEON_HOST/keyloop_scheduler?sslmode=verify-full&sslrootcert=system" \
  -c 'SELECT count(*) FROM "__EFMigrationsHistory"' -c 'CREATE TABLE public.ddl_probe (id int)'
```

Expected: `6`, then `ERROR: permission denied for schema public`.

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

4. **REQUIRES USER CONFIRMATION:** the application. In `build/access/application.template.json`, replace `__ONE_TIME_PIN_IDP_ID__` and `__REVIEWERS_POLICY_ID__`. The body selects: self-hosted on `keyloop.kylesmile.me/auth/*` only (the board, assets and `/api/v1/*` stay public at Access), session 1 hour (short on purpose: the API validates this bearer token offline until its expiry; the web app renews it through the 24-hour Access account session before it ends, ADR-027 "Session duration and renewal"), one-time PIN as the only allowed IdP with automatic redirect, Cookie Path Attribute **disabled** (`path_cookie_attribute: false`, so the cookie reaches `/api/v1/*`), `HttpOnly`, `SameSite=Lax`, binding cookie off, hidden from the App Launcher.

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

Check before going on: domain `keyloop.kylesmile.me`, `workersDev` and `previewUrls` false, no triggers; `DB_URL` is `secret:keyloop_prod_db_url`; `API_IMAGE` is your pushed image reference; `AUTH_TEAM_DOMAIN` and `AUTH_AUDIENCE` are yours; there is no `EMAIL_API_TOKEN`, `GRAFANA_OTLP_BASIC_BROWSER`, `API_OTLP_TOKEN`, `AI_TOKEN` or `TRIAGE_IMAGES` binding; `NOTIFICATIONS_ENABLED`, `EMAIL_SENDING_ENABLED`, `OTLP_RELAY_ENABLED`, `API_OTLP_ENABLED`, `TRIAGE_ENABLED` and `VEHICLE_AWARE_REQUIREMENTS` are `false`; the container is `basic`, one instance, `WEUR`, with your pushed image. `.cloudflare/` is ignored; it holds the role lists in plain text, so do not share it.

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

1. Cold start within 60 s, right after the deploy or after 30 idle minutes: `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$H/api/v1/dealerships"`. Expected `200` in under 60 s; a `503` with `E_API_UNAVAILABLE` means the container did not start (check the Container and Worker logs in the dashboard, which never show the secret). When a deploy changed the configuration of a container that was already running, this first request also waits for the old container to stop: up to 15 s after SIGTERM, then it is killed (`ApiContainerStopTimeout` in the Worker log) and given up to 5 s more, so up to 20 s before the new container starts. The Worker log shows one `ApiContainerRestart` event. If the old container is still running after those 20 s, this request answers `503` with `E_API_UNAVAILABLE`, the previous fingerprint stays recorded, and the next API request tries the restart again.
2. HTTP to HTTPS and HSTS: `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://keyloop.kylesmile.me/board` gives `301 https://keyloop.kylesmile.me/board`; `curl -sSI "$H/" | grep -i strict-transport-security` gives `max-age=31536000`.
3. Nothing internal is public, and the API reference is: `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n'` on `$H/health` and `$H/alive` answers from Static Assets (the SPA's `index.html`, or a plain 404 for a request that is not a navigation), never with API JSON or a health report; `curl -sS -X POST -o /dev/null -w '%{http_code}\n' "$H/api/v1/admin/demo/reseed"` gives `404`. The static reference and the committed contract are public documentation ([README](README.md#static-api-reference)): `curl -sS "$H/scalar/v1" | grep -c 'src="/scalar/standalone.js"'` gives `1`, and `curl -sS "$H/openapi/v1.json" | cmp - contracts/openapi/v1.json` prints nothing. Open `$H/scalar/v1` in a browser (or the board's sidebar "API reference"): the operations render, the developer tools console shows no Content Security Policy error, and the Network panel shows only requests to this hostname; "Test Request" on "List dealerships" answers `200`.
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

## Later configuration changes

A running container keeps the environment it was started with; neither a Worker deploy nor the platform's image rollout changes it. The Durable Object compares a fingerprint of the configuration it would start the container with now against the one it last started it with, once per deploy, on the first API request, and restarts the container when they differ ([README](README.md#configuration-changes-and-container-restarts)). To change a setting, for example enabling triage or vehicle-aware booking (`KEYLOOP_VEHICLE_AWARE_REQUIREMENTS=true`):

1. Set the changed variables with the others from step 6 and run `npm run build`; check the bindings as in step 6.
2. **REQUIRES USER CONFIRMATION:** deploy as in step 7.
3. Send one API request, as in rehearsal item 1. It waits for the old container to stop (up to 15 s after SIGTERM, then up to 5 s after a kill) and the new one to start; a `503` with `E_API_UNAVAILABLE` means the old container did not stop, so send another request, which tries again.
4. In the Worker logs (dashboard), confirm one `ApiContainerRestart` event with reason `configuration-changed` (or `unrecorded`, the first time this behaviour is deployed onto a running container). No event means no running container had to be replaced: either it was already running with this configuration, or it was not running (it sleeps after 30 idle minutes), and this request cold-started it with the new settings. Either way, step 5 confirms that the change took effect.
5. Check the change itself: for triage, signed in as a ServiceAdvisor, describing an issue in the booking dialog returns suggestions instead of the `503 triage-unavailable` fallback to manual selection. For vehicle-aware booking, `curl -sS "$H/api/v1/features"` gives `{"vehicleAwareRequirements":true}`, and, signed in as a ServiceAdvisor, the booking dialog has the vehicle step (with a web build that includes Task 31b).

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

5. **REQUIRES USER CONFIRMATION:** deploy as in [step 7](#7-deploy), with `--message "api telemetry $KL_SHA"`. The dry run should show the new Worker version, the three new bindings and the new image, nothing else. Then send one API request, `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$H/api/v1/dealerships"`, which must answer `200`: the image rollout alone would restart the container with its previous start options, so this request has the Durable Object stop it and start it with the telemetry settings ([Later configuration changes](#later-configuration-changes), steps 3 and 4; one `ApiContainerRestart` event). A `503` with `E_API_UNAVAILABLE` means the container did not start, or the old one did not stop (send another request, which tries again): a missing or malformed `keyloop_prod_api_otlp_token` (whitespace or a non-ASCII character) refuses the start with a message that names only the secret, in the Worker log.
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

To disable, export `KEYLOOP_API_OTLP_ENABLED=false`, rebuild (step 6) and deploy (step 7): the binding disappears, and the first API request restarts the container without any OTEL variable. To rotate, add a new token to the same policy, replace the secret's value (dashboard, or `npx wrangler secrets-store secret update "$KEYLOOP_SECRETS_STORE_ID" --secret-id <id> --remote` with the same `read -rs` and `printf` pattern), redeploy and send one API request so the container restarts with it ([Rollback](#rollback), the secret item), then delete the old token in Grafana. Deleting the token in Grafana stops ingestion at once.

## Rollback

- API image: push the previous tag if it is no longer in the registry, set `KEYLOOP_API_IMAGE` to it, rebuild (step 6) and deploy (step 7). The image reference is part of the fingerprint, so the first API request afterwards stops the container and starts the previous image with the current configuration, whatever start options the platform's rollout kept; confirm the `ApiContainerRestart` event as in [Later configuration changes](#later-configuration-changes).
- A setting: restore the previous value, rebuild and deploy, as in [Later configuration changes](#later-configuration-changes).
- A bad database secret (or AI or API telemetry token): replace `keyloop_prod_db_url` (or `keyloop_prod_ai_token`, `keyloop_prod_api_otlp_token`) in Secrets Store, then **REQUIRES USER CONFIRMATION:** deploy again, `cf deploy --prebuilt --provision=false --message "rotate secret"` with the existing build output (rebuild as in step 6 if it is gone). A running container keeps its start-time value and the Worker reads Secrets Store only when it checks, so the rotation takes effect at the first API request after this deploy, which restarts the container (confirm the `ApiContainerRestart` event). Without a deploy, it takes effect only at the container's next start, for example after it sleeps.
- Neon restores within its six-hour Free history window. Access application and policy changes are reversible in the dashboard.

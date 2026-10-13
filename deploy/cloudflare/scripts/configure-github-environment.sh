#!/usr/bin/env bash
# Controller-only account mutation. Never run with tracing: secrets travel only through stdin.
set +x
set -euo pipefail
unset GH_DEBUG

repo=${1:?Usage: configure-github-environment.sh OWNER/REPO REVIEWER_LOGIN}
reviewer=${2:?Supply the stakeholder GitHub login}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1
[[ "$reviewer" =~ ^[A-Za-z0-9-]+$ ]] || exit 1
command -v gh > /dev/null
command -v jq > /dev/null

# Required-reviewer protection is repository configuration, not a workflow setting.
reviewer_id=$(gh api "users/$reviewer" --jq '.id')
jq -n --argjson id "$reviewer_id" '{wait_timer: 0, prevent_self_review: false,
  reviewers: [{type: "User", id: $id}],
  deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' \
  | gh api --method PUT "repos/$repo/environments/production" --input - > /dev/null
policies=$(gh api "repos/$repo/environments/production/deployment-branch-policies" --paginate --slurp)
if ! jq -e 'any(.[].branch_policies[]; .name == "main" and .type == "branch")' <<< "$policies" > /dev/null; then
  gh api --method POST "repos/$repo/environments/production/deployment-branch-policies" \
    -f name=main -f type=branch > /dev/null
fi

variables=(
  KEYLOOP_ACCESS_TEAM_DOMAIN KEYLOOP_TRIAGE_ENABLED KEYLOOP_TRIAGE_GATEWAY_ID KEYLOOP_TRIAGE_BUCKET
  KEYLOOP_VEHICLE_AWARE_REQUIREMENTS KEYLOOP_API_OTLP_ENABLED KEYLOOP_GRAFANA_OTLP_ENDPOINT
  KEYLOOP_GRAFANA_INSTANCE_ID KEYLOOP_NOTIFICATIONS_ENABLED KEYLOOP_EMAIL_SENDING_ENABLED
  KEYLOOP_OTLP_RELAY_ENABLED KEYLOOP_EMAIL_TRANSPORT KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY
  KEYLOOP_EMAIL_MAX_PER_DAY KEYLOOP_CONTAINER_APPLICATION_ID
)
secrets=(
  CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID KEYLOOP_SECRETS_STORE_ID KEYLOOP_ACCESS_AUDIENCE
  KEYLOOP_ACCESS_ADMIN KEYLOOP_ACCESS_SERVICE_ADVISOR KEYLOOP_ACCESS_VIEWER
  KEYLOOP_TRIAGE_ACCOUNT_ID KEYLOOP_EMAIL_ACCOUNT_ID KEYLOOP_EMAIL_ALLOWED_ADDRESSES
  KEYLOOP_EMAIL_ALLOWED_DOMAINS NEON_OWNER_CONNECTION
)

for name in "${variables[@]}"; do
  value=${!name-}
  case "$name" in
    *_ENABLED|KEYLOOP_VEHICLE_AWARE_REQUIREMENTS) value=${value:-false} ;;
    KEYLOOP_TRIAGE_GATEWAY_ID) value=${value:-keyloop-scheduler} ;;
    KEYLOOP_TRIAGE_BUCKET) value=${value:-keyloop-scheduler-triage} ;;
    KEYLOOP_EMAIL_TRANSPORT) value=${value:-binding} ;;
    KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY) value=${value:-10} ;;
    KEYLOOP_EMAIL_MAX_PER_DAY) value=${value:-100} ;;
    KEYLOOP_ACCESS_TEAM_DOMAIN|KEYLOOP_CONTAINER_APPLICATION_ID)
      [[ -n "$value" ]] || { echo "Set $name locally before running this script." >&2; exit 1; } ;;
  esac
  # stdin is also used for variables. Empty optional values mean the settings.ts default.
  printf '%s' "$value" | gh variable set "$name" --repo "$repo" --env production > /dev/null
  printf '%s' "$value" | gh variable set "$name" --repo "$repo" > /dev/null
done

for name in "${secrets[@]}"; do
  if [[ "${!name+x}" == x ]]; then
    value=${!name}
  else
    printf '%s (hidden; Enter permits an empty optional setting): ' "$name" > /dev/tty
    IFS= read -r -s value < /dev/tty
    printf '\n' > /dev/tty
  fi
  case "$name" in
    CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|KEYLOOP_SECRETS_STORE_ID|KEYLOOP_ACCESS_AUDIENCE|NEON_OWNER_CONNECTION)
      [[ -n "$value" ]] || { echo "$name is required." >&2; exit 1; } ;;
  esac
  printf '%s' "$value" | gh secret set "$name" --repo "$repo" --env production > /dev/null
  if [[ "$name" == CLOUDFLARE_API_TOKEN ]]; then
    # The ungated plan gets a separate token. Do not give it the production Worker's deploy permissions.
    plan_token=${CLOUDFLARE_PLAN_API_TOKEN-}
    if [[ -z "$plan_token" ]]; then
      printf 'CLOUDFLARE_PLAN_API_TOKEN (registry push and instance read only, hidden): ' > /dev/tty
      IFS= read -r -s plan_token < /dev/tty
      printf '\n' > /dev/tty
    fi
    [[ -n "$plan_token" ]] || { echo 'The repository plan token is required.' >&2; exit 1; }
    printf '%s' "$plan_token" | gh secret set "$name" --repo "$repo" > /dev/null
    unset plan_token
  elif [[ "$name" != NEON_OWNER_CONNECTION ]]; then
    printf '%s' "$value" | gh secret set "$name" --repo "$repo" > /dev/null
  fi
  unset value
done
echo 'Production reviewer and main policy configured; environment inputs and repository plan copies set.'
echo 'In Settings, disable administrator bypass, remove old non-main branch policies, and confirm required review is active.'

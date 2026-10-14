#!/usr/bin/env bash
# Compiles the notification email's MJML source into the embedded HTML the API sends.
# Run after editing src/Keyloop.ServiceScheduler.Infrastructure/Notifications/Templates/Notification.mjml and commit both files.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=src/Keyloop.ServiceScheduler.Infrastructure/Notifications/Templates
npx -y mjml@4.15.3 "$dir/Notification.mjml" -o "$dir/Notification.html" --config.minify true --config.validationLevel strict
echo "wrote $dir/Notification.html ($(wc -c < "$dir/Notification.html") bytes)"
git status --short "$dir"

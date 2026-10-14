#!/usr/bin/env bash
# Compiles the notification email's MJML source into the embedded HTML the API sends.
# Run after editing src/Keyloop.ServiceScheduler.Infrastructure/Notifications/Templates/Notification.mjml and commit both files.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=src/Keyloop.ServiceScheduler.Infrastructure/Notifications/Templates
npx -y mjml@4.15.3 "$dir/Notification.mjml" -o "$dir/Notification.html" --config.minify true --config.validationLevel strict
# One line and no trailing newline: SMTP canonicalises line endings to CRLF, so a newline-free body round-trips byte for byte.
python3 - "$dir/Notification.html" <<'PYEOF'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1]); html = p.read_text(encoding="utf-8")
p.write_text(re.sub(r"[ \t]*\r?\n[ \t]*", " ", html).strip(), encoding="utf-8")   # no trailing newline either
PYEOF
echo "wrote $dir/Notification.html ($(wc -c < "$dir/Notification.html") bytes)"
git status --short "$dir"

#!/usr/bin/env bash
# Regenerates contracts/openapi/v1.json via a Release build of the API.
set -euo pipefail
cd "$(dirname "$0")/.."

# Remove the ApiDescription stamp so dotnet build regenerates the document even if the assembly is unchanged.
rm -f src/Keyloop.ServiceScheduler.Api/obj/Keyloop.ServiceScheduler.Api.OpenApiFiles.cache

dotnet build src/Keyloop.ServiceScheduler.Api -c Release && git status --short contracts/

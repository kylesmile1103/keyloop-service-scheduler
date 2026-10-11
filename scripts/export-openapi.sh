#!/usr/bin/env bash
# Regenerates the OpenAPI contract, contracts/openapi/v1.json, and shows whether it changed (ADR-008, Addendum B §B1).
# The document is written by `dotnet build` of the API (build-time generation, no database needed); commit the file with the code
# change that caused it. The web client is generated from it (`pnpm generate:api` in src/Keyloop.ServiceScheduler.Web).
set -euo pipefail
cd "$(dirname "$0")/.."

# Microsoft.Extensions.ApiDescription.Server regenerates only when the API assembly is newer than this stamp; removing it makes the
# build regenerate the document even when the assembly is unchanged (for example after the contract was edited or deleted by hand).
rm -f src/Keyloop.ServiceScheduler.Api/obj/Keyloop.ServiceScheduler.Api.OpenApiFiles.cache

dotnet build src/Keyloop.ServiceScheduler.Api -c Release && git status --short contracts/

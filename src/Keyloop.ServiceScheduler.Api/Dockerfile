# syntax=docker/dockerfile:1
# Multi-stage non-root Scheduler API image. Build from repository root:
#   docker build -f src/Keyloop.ServiceScheduler.Api/Dockerfile -t keyloop-scheduler-api .

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore project dependencies first so package layers stay cached across source changes.
COPY global.json Directory.Build.props Directory.Packages.props .editorconfig ./
COPY src/Keyloop.ServiceScheduler.ServiceDefaults/Keyloop.ServiceScheduler.ServiceDefaults.csproj src/Keyloop.ServiceScheduler.ServiceDefaults/
COPY src/Keyloop.ServiceScheduler.Domain/Keyloop.ServiceScheduler.Domain.csproj src/Keyloop.ServiceScheduler.Domain/
COPY src/Keyloop.ServiceScheduler.Infrastructure/Keyloop.ServiceScheduler.Infrastructure.csproj src/Keyloop.ServiceScheduler.Infrastructure/
COPY src/Keyloop.ServiceScheduler.Api/Keyloop.ServiceScheduler.Api.csproj src/Keyloop.ServiceScheduler.Api/
RUN dotnet restore src/Keyloop.ServiceScheduler.Api/Keyloop.ServiceScheduler.Api.csproj

COPY src/Keyloop.ServiceScheduler.ServiceDefaults/ src/Keyloop.ServiceScheduler.ServiceDefaults/
COPY src/Keyloop.ServiceScheduler.Domain/ src/Keyloop.ServiceScheduler.Domain/
COPY src/Keyloop.ServiceScheduler.Infrastructure/ src/Keyloop.ServiceScheduler.Infrastructure/
COPY src/Keyloop.ServiceScheduler.Api/ src/Keyloop.ServiceScheduler.Api/
# Skip build-time OpenAPI generation during container publish.
RUN dotnet publish src/Keyloop.ServiceScheduler.Api/Keyloop.ServiceScheduler.Api.csproj \
        --configuration Release --no-restore --output /app \
        -p:UseAppHost=false -p:OpenApiGenerateDocumentsOnBuild=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
# curl serves the container health check; tini runs as PID 1 for signal forwarding.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
# The image's non-root user (uid 1654), by number so an orchestrator can verify runAsNonRoot.
USER $APP_UID

# Liveness only (/alive): readiness (/health) includes the database and belongs to the orchestrator's probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent --show-error --output /dev/null http://localhost:8080/alive || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "dotnet", "Keyloop.ServiceScheduler.Api.dll"]

# syntax=docker/dockerfile:1

# Static build of the dispatch board, served by unprivileged nginx with an /api reverse proxy (Addendum C §C5).
# Build context: this directory. Aspire's PublishAsDockerFile() and `docker build .` both use it.

FROM node:22-alpine AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm at the version pinned by package.json "packageManager"
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Type-check and bundle. The generated API client is committed (CI checks drift) and the OpenAPI contract lives outside
# this build context, so the client is not regenerated here.
RUN pnpm exec tsc -b && pnpm exec vite build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# API_UPSTREAM: scheme://host:port of the API, no path. PORT: the port nginx listens on (8080, or what the platform sets).
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS makes the entrypoint export the container's DNS servers as NGINX_LOCAL_RESOLVERS.
ENV API_UPSTREAM=http://api:8080 \
    PORT=8080 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf nginx/proxy.conf /etc/nginx/snippets/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

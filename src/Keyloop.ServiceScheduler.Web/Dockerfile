# syntax=docker/dockerfile:1

# Static dispatch board bundle served by unprivileged nginx with an /api reverse proxy.

FROM node:22-alpine AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Type-check and bundle using the committed generated API client.
RUN pnpm exec tsc -b && pnpm exec vite build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS exports container DNS servers as NGINX_LOCAL_RESOLVERS.
ENV API_UPSTREAM=http://api:8080 \
    PORT=8080 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf nginx/proxy.conf /etc/nginx/snippets/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

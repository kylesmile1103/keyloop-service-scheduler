export const ERROR_PAGES = {
  unauthorized: "/errors/unauthorized",
  forbidden: "/errors/forbidden",
  notFound: "/errors/not-found",
  internalServerError: "/errors/internal-server-error",
  underMaintenance: "/errors/under-maintenance",
} as const

/** Navigation state passed to error pages (`from` return path and `traceId`). */
export interface ErrorPageState {
  from?: string
  traceId?: string
}

/** Maps a terminal HTTP status (401, 403, 404, 5xx) to its error page route, or `null` for inline errors. */
export function errorPageFor(status: number): string | null {
  if (status === 401) return ERROR_PAGES.unauthorized
  if (status === 403) return ERROR_PAGES.forbidden
  if (status === 404) return ERROR_PAGES.notFound
  if (status === 503) return ERROR_PAGES.underMaintenance
  if (status >= 500 && status <= 599) return ERROR_PAGES.internalServerError
  return null
}

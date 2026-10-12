/** Where the error pages live, so any page can send the user to one (`navigate(ERROR_PAGES.forbidden)`). */
export const ERROR_PAGES = {
  unauthorized: "/errors/unauthorized",
  forbidden: "/errors/forbidden",
  notFound: "/errors/not-found",
  internalServerError: "/errors/internal-server-error",
  underMaintenance: "/errors/under-maintenance",
} as const

/**
 * What a page can hand an error page as navigation state: the address to try again (`from`, with its search) and the
 * failure's trace id, for the Aspire dashboard's trace search.
 */
export interface ErrorPageState {
  from?: string
  traceId?: string
}

/** The error page for an HTTP status that ends a whole view (401, 403, 404, 5xx), or `null` for one a view handles in place. */
export function errorPageFor(status: number): string | null {
  if (status === 401) return ERROR_PAGES.unauthorized
  if (status === 403) return ERROR_PAGES.forbidden
  if (status === 404) return ERROR_PAGES.notFound
  if (status === 503) return ERROR_PAGES.underMaintenance
  if (status >= 500 && status <= 599) return ERROR_PAGES.internalServerError
  return null
}

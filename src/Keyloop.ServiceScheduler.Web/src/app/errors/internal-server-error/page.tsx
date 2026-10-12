import { TraceIdRow } from "@/components/problem-alert"

import { ErrorPage } from "../components/error-page"
import { RetryAction } from "../components/retry-action"
import { useErrorPageState } from "../components/use-error-page-state"

/**
 * 500 (`/errors/internal-server-error`): the server failed. With the trace id the sending page passed, so the failure
 * can be found in the Aspire dashboard, and Try again on that page.
 */
export default function InternalServerErrorPage() {
  const { traceId } = useErrorPageState()
  return (
    <ErrorPage title="Something went wrong on the server" illustration="error-connection" action={<RetryAction />}>
      <p>{traceId ? "The server could not finish the request. Trying again often works; if it keeps failing, quote the trace ID." : "The server could not finish the request. Trying again often works."}</p>
      {traceId && <TraceIdRow traceId={traceId} className="max-w-full" />}
    </ErrorPage>
  )
}

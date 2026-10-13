// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/internal-server-error/components/internal-server-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { TraceIdRow } from "@/components/problem-alert"

import { ErrorPage } from "../components/error-page"
import { RetryAction } from "../components/retry-action"
import { useErrorPageState } from "../components/use-error-page-state"

/** 500 error page displaying the request trace ID and retry action. */
export default function InternalServerErrorPage() {
  const { traceId } = useErrorPageState()
  return (
    <ErrorPage title="Something went wrong on the server" illustration="server-error" action={<RetryAction />}>
      <p>{traceId ? "The server could not finish the request. Trying again often works; if it keeps failing, quote the trace ID." : "The server could not finish the request. Trying again often works."}</p>
      {traceId && <TraceIdRow traceId={traceId} className="max-w-full" />}
    </ErrorPage>
  )
}

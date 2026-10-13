// Adopted from shadcn-dashboard-landing-template (vite-version) `src/app/errors/not-found/components/not-found-error.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import { Fragment, type ReactNode } from "react"
import { useLocation } from "react-router-dom"

import { DispatchBoardLink, ErrorPage } from "../components/error-page"

/** The router's 404 (`*`, and `/errors/not-found` to navigate to): nothing lives at the address. */
export default function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <ErrorPage title="Page not found" illustration="not-found" action={<DispatchBoardLink />}>
      <p>
        Nothing lives at <PathText path={pathname}>.</PathText>
      </p>
    </ErrorPage>
  )
}

/**
 * A path that wraps only before a `/` (UI_DESIGN 12.1), so a line never ends inside a segment: each segment, with the `/`
 * that starts it, is one unbreakable box (its hyphens are no break either), with a break allowed between boxes. A segment
 * too long for a whole line is the exception: its box takes the line and wraps inside, so nothing runs out of the page.
 * What follows the path (the sentence's full stop) sits in the last box, in the sentence's own type, so it never starts a
 * line of its own.
 */
function PathText({ path, children }: { path: string; children?: ReactNode }) {
  const segments = path.split(/(?=\/)/)
  return (
    <code className="font-mono text-[0.9em] text-foreground">
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          <span className="inline-block max-w-full wrap-anywhere">
            {segment}
            {index === segments.length - 1 && children && <span className="font-sans text-muted-foreground">{children}</span>}
          </span>
        </Fragment>
      ))}
    </code>
  )
}

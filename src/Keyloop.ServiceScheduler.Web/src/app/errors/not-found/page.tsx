import { CalendarRange } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { IllustratedState } from "@/components/illustrated-state"
import { BaseLayout } from "@/components/layouts/base-layout"
import { buttonVariants } from "@/components/ui/button"

/** The router's 404 (adopted from the template's `errors/not-found`, in the DESIGN_SYSTEM 12.1 layout). */
export default function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <BaseLayout documentTitle="Page not found">
      <div className="flex min-h-[60svh] flex-1 items-center justify-center px-4 md:px-6 xl:px-8">
        <IllustratedState
          illustration="empty-schedule"
          level={1}
          title="Page not found"
          action={
            <Link to="/dispatch" className={buttonVariants()}>
              <CalendarRange aria-hidden="true" />
              Go to the dispatch board
            </Link>
          }
        >
          <p>
            Nothing lives at <code className="font-mono text-[0.9em] break-all text-foreground">{pathname}</code>.
          </p>
        </IllustratedState>
      </div>
    </BaseLayout>
  )
}

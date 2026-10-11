import { CalendarRange } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { BaseLayout } from "@/components/layouts/base-layout"
import { buttonVariants } from "@/components/ui/button"

export default function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <BaseLayout title="Page not found">
      <div className="flex flex-col items-start gap-4 px-4 lg:px-6">
        <p className="max-w-prose text-muted-foreground">
          Nothing lives at <code className="font-mono text-[0.9em] text-foreground break-all">{pathname}</code>. Check the address,
          or go back to the board.
        </p>
        <Link to="/dispatch" className={buttonVariants()}>
          <CalendarRange />
          Go to the dispatch board
        </Link>
      </div>
    </BaseLayout>
  )
}

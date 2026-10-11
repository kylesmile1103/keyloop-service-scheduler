import { CalendarRange, ClipboardList } from "lucide-react"
import { Link } from "react-router-dom"

import { BaseLayout } from "@/components/layouts/base-layout"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export default function AppointmentsPage() {
  return (
    <BaseLayout
      title="Appointments"
      description="Individual bookings, their customers and vehicles."
    >
      <div className="px-4 lg:px-6">
        <Card className="items-center px-6 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg border bg-background">
            <ClipboardList className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="flex max-w-md flex-col gap-2">
            <h2 className="text-base font-semibold">Open appointments from the dispatch board</h2>
            <p className="text-sm text-muted-foreground">
              Select a booking on the board to see its customer, vehicle and allocation, or to cancel it. A searchable
              list of appointments is not part of this release.
            </p>
          </div>
          <Link to="/dispatch" className={buttonVariants()}>
            <CalendarRange />
            Open the dispatch board
          </Link>
        </Card>
      </div>
    </BaseLayout>
  )
}

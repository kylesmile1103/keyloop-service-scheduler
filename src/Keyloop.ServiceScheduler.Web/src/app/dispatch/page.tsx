import { BaseLayout } from "@/components/layouts/base-layout"
import { BoardPlaceholder } from "./components/board-placeholder"

export default function DispatchPage() {
  return (
    <BaseLayout
      title="Dispatch Board"
      description="Bays, technicians and booked work for one workshop day."
    >
      <div className="px-4 lg:px-6">
        <BoardPlaceholder />
      </div>
    </BaseLayout>
  )
}

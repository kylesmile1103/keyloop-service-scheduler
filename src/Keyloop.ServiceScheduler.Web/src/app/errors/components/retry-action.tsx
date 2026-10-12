import { RotateCw } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"

import { DispatchBoardLink } from "./error-page"
import { useErrorPageState } from "./use-error-page-state"

/** Try again on the page that sent the user here, or the dispatch board when no page did. */
export function RetryAction() {
  const { from } = useErrorPageState()
  const navigate = useNavigate()
  if (!from) return <DispatchBoardLink />
  return (
    <Button type="button" className="cursor-pointer" onClick={() => navigate(from, { replace: true })}>
      <RotateCw aria-hidden="true" />
      Try again
    </Button>
  )
}

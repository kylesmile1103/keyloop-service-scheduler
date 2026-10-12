import { Navigate, useLocation } from "react-router-dom"

/** A section's own address leads to its first page, keeping the search (`/resources?dealership=…` to its technicians). */
export function KeepSearch({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={{ pathname: to, search }} replace />
}

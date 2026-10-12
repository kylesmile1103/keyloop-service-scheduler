import { useEffect, useState } from "react"

/** The current instant, refreshed every `intervalMs` so the "now" line, today's date and live figures keep moving. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}

import { useEffect, useState } from "react"

/** A whole-second countdown (a rate limit's wait): `start(seconds)` sets it, and it ticks down to 0. */
export function useCountdown(): [number, (seconds: number) => void] {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => setRemaining((left) => left - 1), 1000)
    return () => clearTimeout(timer)
  }, [remaining])
  return [remaining, setRemaining]
}

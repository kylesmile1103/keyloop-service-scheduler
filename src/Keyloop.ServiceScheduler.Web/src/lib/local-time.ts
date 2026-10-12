const timeFormats = new Map<string, Intl.DateTimeFormat>()

/** `HH:mm` as the clock on the dealership's wall shows it (24-hour), whatever the browser's zone. */
export function formatLocalTime(iso: string, timeZone: string): string {
  let format = timeFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    timeFormats.set(timeZone, format)
  }
  return format.format(new Date(iso))
}

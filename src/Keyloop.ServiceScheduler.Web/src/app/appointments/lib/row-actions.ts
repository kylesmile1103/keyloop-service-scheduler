import { createContext } from "react"

import type { AppointmentRow } from "./appointments"

/** What a row's action asks for: the details sheet, opened on its title or on the cancellation's reason. */
export type RowIntent = "details" | "cancel"

/** Opens the details sheet for a row; `trigger` is where focus returns when the sheet closes. */
export type OpenAppointment = (row: AppointmentRow, intent: RowIntent, trigger: HTMLElement) => void

/** Context providing the row details sheet callback so column definitions stay module-level constants. */
export const OpenAppointmentContext = createContext<OpenAppointment>(() => {})

import { createContext } from "react"

import type { AppointmentRow } from "./appointments"

/** What a row's action asks for: the details sheet, opened on its title or on the cancellation's reason. */
export type RowIntent = "details" | "cancel"

/** Opens the details sheet for a row; `trigger` is where focus returns when the sheet closes. */
export type OpenAppointment = (row: AppointmentRow, intent: RowIntent, trigger: HTMLElement) => void

/**
 * How a row's actions open the details sheet. The list provides it, so the column definitions stay one module-level
 * constant (TanStack Table v9 wants stable columns) while the sheet's state lives in the page.
 */
export const OpenAppointmentContext = createContext<OpenAppointment>(() => {})

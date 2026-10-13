import type { ReturningCustomerResponse } from "@/api/types.gen"

/**
 * `POST /dealerships/{id}/customer-lookups` answers (Task 39), as the API returns them: the most recent booking's customer
 * and vehicle of each matching customer-and-vehicle pair, latest first, with how many bookings the pair has.
 */

/** Grace Hopper's Golf: three visits, the last on Monday 12 October 2026 at 10:00 in Reading (09:00 UTC). */
export const graceGolf: ReturningCustomerResponse = {
  customer: { name: "Grace Hopper", email: "grace.hopper@example.com", phone: "+44 7700 900123" },
  vehicle: { vin: "WVWZZZ1KZAW654321", registration: "RK22 ABC", make: "Volkswagen", model: "Golf" },
  lastVisitUtc: "2026-10-12T09:00:00Z",
  visits: 3,
}

/** The same customer's other car, booked once, in August. */
export const graceYaris: ReturningCustomerResponse = {
  customer: { name: "Grace Hopper", email: "grace.hopper@example.com", phone: "+44 7700 900123" },
  vehicle: { vin: "JTDKN3DU0A0123499", registration: "RK19 GHY", make: "Toyota", model: "Yaris" },
  lastVisitUtc: "2026-08-28T13:30:00Z",
  visits: 1,
}

/**
 * Ada Lovelace's Clio, with no email on file: her last visit started at 00:30 on 5 October in Reading (BST), which is
 * still 4 October in UTC, so the date shown is the dealership's.
 */
export const adaClio: ReturningCustomerResponse = {
  customer: { name: "Ada Lovelace", email: "", phone: "+44 7700 900456" },
  vehicle: { vin: "VF1RFB00X59123411", registration: "RX17 ADA", make: "Renault", model: "Clio" },
  lastVisitUtc: "2026-10-04T23:30:00Z",
  visits: 2,
}

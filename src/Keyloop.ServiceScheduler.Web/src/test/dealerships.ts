import type { DealershipResponse } from "@/api/types.gen"

/**
 * The two dealerships the API seeds in Development (ReferenceDataSeed), with their real ids and hours. GET /api/v1/dealerships
 * orders by name, so the API lists München first; tests pass whichever order they need.
 */
export const reading: DealershipResponse = {
  id: "45fa64a1-baa9-8c61-b11a-ee9d7572ae3e",
  name: "Keyloop Motors Reading",
  timeZoneId: "Europe/London",
  operatingHours: [
    { day: "Monday", opensAt: "08:00", closesAt: "18:00" },
    { day: "Tuesday", opensAt: "08:00", closesAt: "18:00" },
    { day: "Wednesday", opensAt: "08:00", closesAt: "18:00" },
    { day: "Thursday", opensAt: "08:00", closesAt: "18:00" },
    { day: "Friday", opensAt: "08:00", closesAt: "18:00" },
    { day: "Saturday", opensAt: "08:00", closesAt: "13:00" },
    { day: "Sunday", opensAt: null, closesAt: null },
  ],
}

export const munich: DealershipResponse = {
  id: "b5764fd6-421e-8d7e-9c41-16d2f95e1405",
  name: "Keyloop Autohaus München",
  timeZoneId: "Europe/Berlin",
  operatingHours: [
    { day: "Monday", opensAt: "07:30", closesAt: "18:30" },
    { day: "Tuesday", opensAt: "07:30", closesAt: "18:30" },
    { day: "Wednesday", opensAt: "07:30", closesAt: "18:30" },
    { day: "Thursday", opensAt: "07:30", closesAt: "18:30" },
    { day: "Friday", opensAt: "07:30", closesAt: "18:30" },
    { day: "Saturday", opensAt: null, closesAt: null },
    { day: "Sunday", opensAt: null, closesAt: null },
  ],
}

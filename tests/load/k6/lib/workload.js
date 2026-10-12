import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { config } from './config.js';
import { availability, schedule, book, bookingBody, cancel, appointment, header, json, mustRead,
  lifecycleCompleted, orphansCancelled } from './api.js';

export function readAvailability(context, date) {
  const response = availability(context, date);
  if (response.status === 429) return null;
  const body = json(response);
  const valid = check(response, { 'availability is for requested date': () => response.status === 200 &&
    body?.date === date && Array.isArray(body.slots) && body.durationMinutes === context.service.durationMinutes }, { endpoint: 'GetAvailability' });
  return valid ? body : null;
}

export function readSchedule(context, date) {
  const response = schedule(context, date);
  if (response.status === 429) return null;
  const body = json(response);
  const valid = check(response, { 'schedule is for requested dealership and date': () => response.status === 200 &&
    body?.date === date && body.dealership?.id === context.dealership.id && Array.isArray(body.bays) &&
    Array.isArray(body.technicians) }, { endpoint: 'GetWorkshopSchedule' });
  return valid ? body : null;
}

export function readIteration(context) {
  const date = context.dates[exec.scenario.iterationInTest % context.dates.length];
  readAvailability(context, date);
  readSchedule(context, date);
}

export function lifecycle(context, date) {
  const available = readAvailability(context, date);
  if (!available) return;
  check(available, { 'booking workload has an available slot': () => available.slots.length > 0 });
  if (available.slots.length === 0) return;
  const slot = available.slots[exec.scenario.iterationInTest % available.slots.length];
  const body = bookingBody(context, slot);
  const key = `${context.runId}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;
  const first = book(context, body, key);
  if (first.status !== 201) return;
  const original = json(first);
  if (!original?.id) return;
  let retry, cancelledResponse, secondCancel;
  try {
    // Identical payload and key, no regeneration. A successful replay must be
    // the stored 201, including Location and the replay header.
    retry = book(context, body, key);
    const replayValid = check(retry, {
      'retry replays the original 201': () => retry.status === 201 &&
        header(retry, 'Idempotent-Replayed') === 'true' &&
        header(retry, 'Location') === header(first, 'Location') &&
        retry.body === first.body && json(retry)?.id === original.id,
    }, { endpoint: 'BookAppointment' });
    const stored = appointment(original.id);
    check(stored, { 'booked appointment can be read': () => stored.status === 200 &&
      json(stored)?.id === original.id && json(stored)?.status === 'Confirmed' }, { endpoint: 'GetAppointment' });
    if (!replayValid) return;
  } finally {
    // Reclaim every acknowledged booking, even if a replay check fails.
    cancelledResponse = cancel(original.id);
    if (cancelledResponse.status === 200) secondCancel = cancel(original.id, true);
  }
  const cancelledRead = appointment(original.id);
  const released = readSchedule(context, date);
  const verified = check(cancelledRead, {
    'cancelled appointment is readable and absent from schedule': () => cancelledRead.status === 200 &&
      json(cancelledRead)?.status === 'Cancelled' && released !== null &&
      released.bays.every((bay) => bay.appointments.every((a) => a.id !== original.id)),
  }, { endpoint: 'GetAppointment' });
  if (verified && retry.status === 201 && cancelledResponse.status === 200 && secondCancel?.status === 409) lifecycleCompleted.add(1);
}

export function mixedIteration(context) {
  // Deterministic 60% availability, 20% lifecycle, 20% schedule. The first
  // iteration runs a lifecycle, making even a small smoke run exercise writes.
  const index = exec.scenario.iterationInTest;
  const date = context.dates[index % context.dates.length];
  if (index % 5 === 0) lifecycle(context, context.bookingDates[Math.floor(index / 5) % context.bookingDates.length]);
  else if (index % 5 === 4) readSchedule(context, date);
  else readAvailability(context, date);
}

// A lifecycle cancels its own booking in a finally block, but an aborted or
// interrupted iteration never reaches it. Teardown therefore cancels whatever
// this run still holds on its booking dates; any such leftover fails the
// orphans_cancelled gate. Under the Production preset it first waits one full
// limiter window, because a 429 abort leads straight here.
export function cancelLeftoverBookings(context) {
  if (config.production) sleep(65);
  for (const date of context.bookingDates) {
    const board = mustRead(schedule(context, date, 'teardown'), 'Leftover booking schedule');
    const leftovers = board.bays.flatMap((bay) => bay.appointments).filter((a) =>
      a.status === 'Confirmed' && a.customerName.startsWith(`${context.runId}-`));
    for (const leftover of leftovers) {
      if (cancel(leftover.id, false, 'teardown').status === 200) orphansCancelled.add(1);
    }
  }
}

// ARCHITECTURE 4.2 sets availability p95 < 100 ms and booking p95 < 150 ms.
// The schedule p95 and every p99 are local budgets with no design target.
export function readThresholds() {
  return {
    'http_req_duration{endpoint:GetAvailability,phase:workload}': ['p(95)<100', 'p(99)<500'],
    'http_req_duration{endpoint:GetWorkshopSchedule,phase:workload}': ['p(95)<200', 'p(99)<500'],
  };
}

export function workloadThresholds() {
  return {
    ...readThresholds(),
    'http_req_duration{endpoint:BookAppointment,phase:workload}': ['p(95)<150', 'p(99)<500'],
    booking_success: ['count>0'], replayed: ['count>0'], lifecycle_completed: ['count>0'],
    cancelled: ['count>0'], second_cancel_conflicts: ['count>0'], orphans_cancelled: ['count==0'],
  };
}

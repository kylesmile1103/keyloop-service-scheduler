import { check } from 'k6';
import exec from 'k6/execution';
import { availability, schedule, book, bookingBody, cancel, appointment, header, json, lifecycleCompleted } from './api.js';

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

export function workloadThresholds() {
  return {
    'http_req_duration{endpoint:GetAvailability,phase:workload}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{endpoint:GetWorkshopSchedule,phase:workload}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{endpoint:BookAppointment,phase:workload}': ['p(95)<150', 'p(99)<500'],
    booking_success: ['count>0'], replayed: ['count>0'], lifecycle_completed: ['count>0'],
    cancelled: ['count>0'], second_cancel_conflicts: ['count>0'],
  };
}

import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import { config, fraction, optionalInteger } from './config.js';

export const bookingSuccess = new Counter('booking_success');
export const bookingConflicts = new Counter('booking_conflicts');
export const replayed = new Counter('replayed');
export const unexpectedStatuses = new Rate('unexpected_statuses');
export const serverErrors = new Counter('server_errors');
export const rateLimited = new Rate('rate_limited');
export const retryAfterSeconds = new Trend('retry_after_seconds');
export const lifecycleCompleted = new Counter('lifecycle_completed');
export const cancelled = new Counter('cancelled');
export const secondCancelConflicts = new Counter('second_cancel_conflicts');
export const orphansCancelled = new Counter('orphans_cancelled');

// rateLimitBudget is the default fraction of HTTP attempts allowed to be 429s
// (MAX_RATE_LIMIT_RATE overrides it). droppedIterations is the default number
// of dropped iterations allowed (MAX_DROPPED_ITERATIONS overrides it); null
// reports them without a gate, for a profile whose VUs are expected to wait
// out Retry-After while the arrival-rate executor keeps offering iterations.
export function baseThresholds({ rateLimitBudget = 0.01, droppedIterations = 0 } = {}) {
  const thresholds = {
    checks: ['rate==1'],
    unexpected_statuses: ['rate==0'],
    server_errors: ['count==0'],
    http_req_failed: ['rate<0.01'],
    rate_limited: [`rate<=${fraction('MAX_RATE_LIMIT_RATE', rateLimitBudget)}`],
    iterations: ['count>0'],
  };
  const drops = optionalInteger('MAX_DROPPED_ITERATIONS', droppedIterations);
  if (drops !== null) thresholds.dropped_iterations = [`count<=${drops}`];
  return thresholds;
}

export function initializeMetrics() {
  [bookingSuccess, bookingConflicts, replayed, serverErrors, lifecycleCompleted,
    cancelled, secondCancelConflicts, orphansCancelled].forEach((metric) => metric.add(0));
}

export function header(response, name) {
  const key = Object.keys(response.headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return key ? response.headers[key] : undefined;
}

export function json(response) {
  try { return response.json(); } catch (_) { return null; }
}

export function problem(response, slugs, startUtc, requireSuggestions = false, tags = {}) {
  const body = json(response);
  const valid = Boolean(body && body.status === response.status &&
    slugs.some((slug) => body.type === `https://api.keyloop.example/problems/${slug}`) &&
    typeof body.traceId === 'string' && body.traceId.length > 0 &&
    String(header(response, 'Content-Type')).startsWith('application/problem+json'));
  const suggestions = !requireSuggestions || Boolean(body && Array.isArray(body.suggestedSlots) &&
    body.suggestedSlots.every((slot) => Number.isFinite(Date.parse(slot.startUtc)) &&
      Date.parse(slot.endUtc) > Date.parse(slot.startUtc) &&
      Date.parse(slot.startUtc) !== Date.parse(startUtc)));
  return check(response, { 'problem matches contract': () => valid && suggestions }, tags);
}

// The Retry-After cooldown is per VU by design: each VU models one client, and
// all VUs share the generator's IP like clients behind one NAT. k6 has no
// mutable state shared across VUs, so other VUs learn of the limit only from
// their own 429. The Production preset, required for every remote run, does
// not rely on that: the first workload 429 aborts the whole test (k6 exit 108)
// so the IP stops sending. Setup and teardown run alone in one VU, where this
// cooldown pauses every request from the IP, so they wait and retry instead.
let nextRequestAt = 0;
export function request(method, path, endpoint, body, expected, settings = {}) {
  if (settings.backoff !== false) sleep(Math.max(0, nextRequestAt - Date.now()) / 1000);
  const accepted = [...expected, 429];
  const tags = { endpoint, name: endpoint, phase: settings.phase || 'workload', ...settings.tags };
  const response = http.request(method, `${config.baseUrl}/api/v1${path}`,
    body === undefined ? null : JSON.stringify(body), {
      headers: { Accept: 'application/json, application/problem+json',
        'Content-Type': 'application/json', ...settings.headers },
      tags, timeout: config.timeout, redirects: 0,
      responseCallback: http.expectedStatuses(...accepted),
    });
  const ok = accepted.includes(response.status);
  unexpectedStatuses.add(!ok, tags);
  serverErrors.add(response.status >= 500 ? 1 : 0, tags);
  rateLimited.add(response.status === 429, tags);
  check(response, { 'only expected statuses': () => ok }, tags);
  if (response.status === 429) {
    problem(response, ['rate-limited'], undefined, false, tags);
    const delay = header(response, 'Retry-After');
    const valid = /^\d+$/.test(String(delay)) && Number(delay) >= 1 && json(response)?.retryAfterSeconds === Number(delay);
    check(response, { '429 has valid Retry-After': () => valid }, tags);
    const wait = valid ? Number(delay) : 60;
    retryAfterSeconds.add(wait, tags);
    nextRequestAt = Date.now() + wait * 1000;
    if (config.production && !['setup', 'teardown'].includes(tags.phase)) {
      exec.test.abort(`429 on ${endpoint} under the Production preset, Retry-After ${wait}s; stopping all VUs`);
    }
    // Contention must finish this request as a 429 and fail its exact counts.
    // It never converts a throttled contender into a later booking attempt.
    if (settings.backoff === false) sleep(wait);
  }
  return response;
}

export function withRetry(method, path, endpoint, body, expected, settings = {}) {
  let response;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    response = request(method, path, endpoint, body, expected, settings);
    if (response.status !== 429) return response;
  }
  return response;
}

export const availability = (context, date, phase = 'workload') => withRetry('GET',
  `/dealerships/${context.dealership.id}/availability?serviceTypeId=${context.service.id}&date=${date}`,
  'GetAvailability', undefined, [200], { phase });
export const schedule = (context, date, phase = 'workload') => withRetry('GET',
  `/dealerships/${context.dealership.id}/schedule?date=${date}`,
  'GetWorkshopSchedule', undefined, [200], { phase });
export const appointment = (id, phase = 'workload') => withRetry('GET',
  `/appointments/${id}`, 'GetAppointment', undefined, [200], { phase });

export function mustRead(response, label) {
  const body = json(response);
  if (response.status !== 200 || body === null) throw new Error(`${label} failed, status ${response.status}`);
  return body;
}

export function dates() {
  return Array.from({ length: config.searchDays }, (_, index) =>
    new Date(Date.now() + (config.firstDay + index) * 86400000).toISOString().slice(0, 10));
}

export function discover(singleCapacity = false) {
  initializeMetrics();
  const dealerships = mustRead(withRetry('GET', '/dealerships', 'GetDealerships', undefined, [200], { phase: 'setup' }), 'Dealership discovery');
  if (!Array.isArray(dealerships)) throw new Error('Expected a dealership catalogue');
  const candidates = dealerships.filter((d) => !config.dealershipId || d.id === config.dealershipId);
  // Prefer Reading, with a generic fallback for any catalogue exposed by the API.
  candidates.sort((a, b) => Number(!a.name.includes('Reading')) - Number(!b.name.includes('Reading')));
  const code = config.serviceCode || (singleCapacity ? 'EV-BATTERY-CHECK' : 'INTERIM-SERVICE');
  for (const dealership of candidates) {
    const services = mustRead(withRetry('GET', `/dealerships/${dealership.id}/service-types`,
      'GetServiceTypes', undefined, [200], { phase: 'setup' }), 'Service discovery');
    const service = services.find((s) => s.bookable && s.code === code);
    if (!service) continue;
    const context = { dealership, service, dates: dates(), runId: `k6-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}` };
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    context.bookingDates = context.dates.filter((date) => dealership.operatingHours.some((hours) =>
      hours.day === weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] && hours.opensAt !== null));
    if (context.bookingDates.length === 0) continue;
    if (singleCapacity) {
      const board = mustRead(schedule(context, context.dates[0], 'setup'), 'Resource discovery');
      const bays = board.bays.filter((b) => b.isActive && service.requiredBayCapabilities.every((c) => b.capabilities.includes(c)));
      // The single qualified bay is the contended resource: every contender needs it, so exactly one can win however many
      // technicians qualify. With vehicle-aware requirements on, technicians qualify by HV level rather than the legacy
      // certification, so more than one can (Development), and availability then reports two free technicians.
      if (bays.length !== 1) continue;
      context.bayId = bays[0].id;
    }
    return context;
  }
  throw new Error(`No eligible dealership for ${code}${singleCapacity ? ' with exactly one qualified bay' : ''}`);
}

export function bookingBody(context, slot, suffix = '') {
  const sequence = `${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${suffix}`;
  const customerId = `${context.runId}-${sequence}`;
  // 17 VIN characters, no I/O/Q. The API validates syntax, not a check digit.
  const serial = `${exec.vu.idInTest.toString().padStart(5, '0')}${exec.scenario.iterationInTest.toString().padStart(6, '0')}`.slice(-11);
  return {
    serviceTypeId: context.service.id, startUtc: slot.startUtc,
    customer: { name: customerId, email: `${customerId}@example.invalid`, phone: '+44 7700 900123' },
    vehicle: { vin: `WVWZZZ${serial}`, registration: `K6 ${serial}`.slice(0, 16), make: 'Volkswagen', model: 'Golf' },
    notes: `Synthetic load test ${context.runId}`,
  };
}

export function book(context, body, key, settings = {}) {
  const tags = { endpoint: 'BookAppointment', ...settings.tags };
  const call = settings.backoff === false ? request : withRetry;
  const response = call('POST', `/dealerships/${context.dealership.id}/appointments`, 'BookAppointment',
    body, [201, 409], { ...settings, headers: key ? { 'Idempotency-Key': key } : {} });
  if (response.status === 409) {
    bookingConflicts.add(1, tags);
    problem(response, ['slot-unavailable', 'slot-conflict'], body.startUtc, true, tags);
  } else if (response.status === 201) {
    const replay = header(response, 'Idempotent-Replayed') === 'true';
    (replay ? replayed : bookingSuccess).add(1, tags);
    const result = json(response);
    check(response, { '201 identifies requested booking': () => Boolean(result?.id &&
      result.dealershipId === context.dealership.id && result.serviceType?.id === body.serviceTypeId &&
      Date.parse(result.startUtc) === Date.parse(body.startUtc) && result.vehicle?.vin === body.vehicle.vin &&
      result.customer?.name === body.customer.name && result.status === 'Confirmed' &&
      header(response, 'Location') === `/api/v1/appointments/${result.id}`) }, { endpoint: 'BookAppointment' });
  }
  return response;
}

export function cancel(id, second = false, phase = 'workload') {
  const response = withRetry('POST', `/appointments/${id}/cancel`, 'CancelAppointment',
    { reason: 'Synthetic load test cleanup' }, second ? [409] : [200], { phase });
  if (second && response.status === 409) {
    secondCancelConflicts.add(1, { endpoint: 'CancelAppointment' });
    problem(response, ['invalid-state-transition'], undefined, false, { endpoint: 'CancelAppointment' });
    const body = json(response);
    check(response, { 'second cancel reports Cancelled state': () => body?.currentStatus === 'Cancelled' && body.attempted === 'cancel' }, { endpoint: 'CancelAppointment' });
  } else if (!second && response.status === 200) {
    cancelled.add(1, { endpoint: 'CancelAppointment' });
    check(response, { 'cancel returns Cancelled appointment': () => json(response)?.id === id && json(response)?.status === 'Cancelled' }, { endpoint: 'CancelAppointment' });
  }
  return response;
}

export function activeOverlaps(board, context, slot) {
  return board.bays.flatMap((bay) => bay.appointments.filter((a) =>
    ['Confirmed', 'CheckedIn', 'InProgress'].includes(a.status) &&
    bay.id === context.bayId &&
    Date.parse(a.startUtc) < Date.parse(slot.endUtc) && Date.parse(a.endUtc) > Date.parse(slot.startUtc)));
}

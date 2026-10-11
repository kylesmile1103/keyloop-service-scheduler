import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import { config, commonOptions, integer } from './lib/config.js';
import { discover, availability, schedule, mustRead, book, bookingBody, appointment,
  json, cancel, activeOverlaps, baseThresholds } from './lib/api.js';
import { summarize } from './lib/summary.js';

const contenders = integer('CONTENDERS', 30, 2, config.production ? 30 : 1000);
const rounds = integer('ROUNDS', 5, 1, 20);
const interval = integer('ROUND_INTERVAL_SECONDS', config.production ? 65 : 20, config.production ? 65 : 4, 3600);
const gateMs = integer('GATE_MS', 1000, 100, 5000);
if (gateMs >= (interval - 2) * 1000) throw new Error('GATE_MS must leave time for booking within each round');
const tolerance = integer('START_TOLERANCE_MS', 250, 1, 1000);
const participants = new Counter('contention_participants');
const uniqueParticipants = new Rate('contention_unique_participants');
const startLag = new Trend('contention_start_lag', true);
const verified = new Counter('contention_verified');

const thresholds = {
  ...baseThresholds(0),
  booking_success: [`count==${rounds}`],
  booking_conflicts: [`count==${rounds * (contenders - 1)}`],
  replayed: ['count==0'],
  contention_participants: [`count==${rounds * contenders}`],
  contention_unique_participants: ['rate==1'],
  contention_start_lag: [`max<${tolerance}`],
  contention_verified: [`count==${rounds}`],
};
const scenarios = {};
for (let round = 1; round <= rounds; round++) {
  const tags = `round:${round}`;
  thresholds[`booking_success{${tags}}`] = ['count==1'];
  thresholds[`booking_conflicts{${tags}}`] = [`count==${contenders - 1}`];
  thresholds[`contention_participants{${tags}}`] = [`count==${contenders}`];
  scenarios[`round_${round}`] = {
    executor: 'shared-iterations', exec: 'contend', vus: contenders, iterations: contenders,
    startTime: `${(round - 1) * interval}s`, maxDuration: `${interval - 1}s`, gracefulStop: '0s',
    tags: { round: String(round) },
  };
}
export const options = { ...commonOptions(thresholds), scenarios };

export function setup() {
  const context = discover(true);
  verified.add(0);
  context.slots = [];
  for (const date of context.dates) {
    const board = mustRead(schedule(context, date, 'setup'), 'Fresh-slot schedule');
    const available = mustRead(availability(context, date, 'setup'), 'Fresh-slot availability');
    const reserved = available.slots[available.slots.length - 1];
    for (const slot of available.slots) {
      if (slot.freeBays !== 1 || slot.freeTechnicians !== 1 || activeOverlaps(board, context, slot).length !== 0) continue;
      if (context.slots.some((chosen) => Date.parse(chosen.startUtc) < Date.parse(slot.endUtc) &&
        Date.parse(chosen.endUtc) > Date.parse(slot.startUtc))) continue;
      // Preserve one full alternative per day, so later rounds cannot exhaust
      // suggestions and turn a correct conflict into a fixture failure.
      if (reserved && Date.parse(slot.startUtc) < Date.parse(reserved.endUtc) &&
        Date.parse(slot.endUtc) > Date.parse(reserved.startUtc)) continue;
      context.slots.push({ ...slot, date });
      if (context.slots.length === rounds) return context;
    }
  }
  throw new Error(`Need ${rounds} fresh single-capacity slots; discovered ${context.slots.length}`);
}

export function contend(context) {
  const round = Number(exec.scenario.name.split('_')[1]);
  const tags = { round: String(round) };
  const firstIteration = exec.vu.iterationInScenario === 0;
  uniqueParticipants.add(firstIteration, tags);
  // shared-iterations does not promise one iteration per VU. Reject any VU
  // taking a second iteration instead of silently reducing the contender set.
  if (!firstIteration) return;
  const slot = context.slots[round - 1];
  const body = bookingBody(context, slot, `round${round}`);
  const key = round % 2 === 0 ? `${context.runId}-r${round}-v${exec.vu.idInTest}` : undefined;
  const releaseAt = exec.scenario.startTime + gateMs;
  sleep(Math.max(0, releaseAt - Date.now()) / 1000);
  startLag.add(Math.max(0, Date.now() - releaseAt), tags);
  participants.add(1, tags);
  const response = book(context, body, key, { tags, backoff: false });
  check(response, { 'contender is a winner or a slot conflict': () => [201, 409].includes(response.status) }, tags);
  if (response.status === 409) {
    check(response, { 'contender has alternative slots': () => json(response)?.suggestedSlots?.length > 0 }, tags);
  }
}

export function teardown(context) {
  // setup data is immutable across VUs. Find winners through the public board,
  // then dereference them through GetAppointment before cancelling our own rows.
  // Each round fits the Production write window. Leave room for cancellations
  // too when the final round used all or most of its 30 write permits.
  if (config.production && contenders + rounds > 30) sleep(65);
  for (let index = 0; index < context.slots.length; index++) {
    const slot = context.slots[index];
    const tags = { round: String(index + 1) };
    const board = mustRead(schedule(context, slot.date, 'teardown'), 'Winner schedule');
    const overlaps = activeOverlaps(board, context, slot);
    const winners = overlaps.filter((a) => a.serviceType.id === context.service.id &&
      Date.parse(a.startUtc) === Date.parse(slot.startUtc) && Date.parse(a.endUtc) === Date.parse(slot.endUtc) &&
      a.customerName.startsWith(`${context.runId}-`));
    const exactlyOne = check(board, { 'exactly one active appointment occupies the single-capacity slot': () =>
      overlaps.length === 1 && winners.length === 1 }, tags);
    if (exactlyOne) {
      const response = appointment(winners[0].id, 'teardown');
      const stored = json(response);
      const matches = check(response, { 'winner detail matches slot and qualified resources': () =>
        response.status === 200 && stored?.id === winners[0].id && stored.status === 'Confirmed' &&
        stored.bay.id === context.bayId && stored.technician.id === context.technicianId &&
        Date.parse(stored.startUtc) === Date.parse(slot.startUtc) && Date.parse(stored.endUtc) === Date.parse(slot.endUtc) &&
        stored.customer.name.startsWith(`${context.runId}-`) }, tags);
      if (matches) verified.add(1, tags);
    }
    // Restrict cleanup to appointments identified as this run's winners.
    for (const winner of winners) cancel(winner.id, false, 'teardown');
  }
}

export const handleSummary = (data) => summarize('booking-contention', data);

import { config, commonOptions, integer, arrivalRate } from './lib/config.js';
import { discover, baseThresholds } from './lib/api.js';
import { readIteration } from './lib/workload.js';
import { summarize } from './lib/summary.js';

// Development: the 360/min peak offers about 720 requests/min, over twice the
// 300/min global quota per IP, so this spike exercises admission control. The
// gate is valid 429s with Retry-After, no unexpected statuses or 5xx, at most
// half of the attempts throttled, and bounded latency for admitted (200) reads.
// VUs waiting out Retry-After make the executor drop offered iterations, which
// is the intended back-off, so dropped iterations are reported, not gated.
// Production: the 120/min peak stays under quota, the first 429 aborts the run
// and a dropped iteration is a capacity failure.
const peak = arrivalRate(config.production ? 120 : 360, 120);
const base = integer('BASE_RATE', 30, 1, config.production ? 120 : 1000000);
export const options = {
  ...commonOptions({
    ...baseThresholds({ rateLimitBudget: 0.5, droppedIterations: config.production ? 0 : null }),
    'http_req_duration{endpoint:GetAvailability,phase:workload,status:200}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{endpoint:GetWorkshopSchedule,phase:workload,status:200}': ['p(95)<500', 'p(99)<1000'],
  }),
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate', exec: 'reads', timeUnit: '1m',
      startRate: base,
      preAllocatedVUs: config.preAllocatedVUs, maxVUs: config.maxVUs,
      stages: [
        { duration: __ENV.WARM_DURATION || '15s', target: base },
        { duration: __ENV.SPIKE_RAMP || '1s', target: peak },
        { duration: __ENV.SPIKE_HOLD || '30s', target: peak },
        { duration: __ENV.RECOVERY_DURATION || '1m', target: base },
      ], gracefulStop: __ENV.GRACEFUL_STOP || '1m',
    },
  },
};
export const setup = () => discover();
export const reads = readIteration;
export const handleSummary = (data) => summarize('spike', data);

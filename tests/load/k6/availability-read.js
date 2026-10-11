import { config, commonOptions, arrivalRate } from './lib/config.js';
import { discover, baseThresholds } from './lib/api.js';
import { readIteration } from './lib/workload.js';
import { summarize } from './lib/summary.js';

const rate = arrivalRate(config.production ? 80 : 120, 120);
export const options = {
  ...commonOptions({
    ...baseThresholds(),
    'http_req_duration{endpoint:GetAvailability,phase:workload}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{endpoint:GetWorkshopSchedule,phase:workload}': ['p(95)<200', 'p(99)<500'],
  }),
  scenarios: {
    availability: {
      executor: 'ramping-arrival-rate', exec: 'reads', timeUnit: '1m',
      startRate: Math.max(1, Math.floor(rate / 4)),
      preAllocatedVUs: config.preAllocatedVUs, maxVUs: config.maxVUs,
      stages: [
        { duration: __ENV.RAMP_DURATION || '30s', target: rate },
        { duration: __ENV.HOLD_DURATION || '3m', target: rate },
        { duration: __ENV.RAMP_DURATION || '30s', target: 0 },
      ], gracefulStop: __ENV.GRACEFUL_STOP || '10s',
    },
  },
};
export const setup = () => discover();
export const reads = readIteration;
export const handleSummary = (data) => summarize('availability-read', data);

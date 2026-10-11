import { config, commonOptions, integer, arrivalRate } from './lib/config.js';
import { discover, baseThresholds } from './lib/api.js';
import { readIteration } from './lib/workload.js';
import { summarize } from './lib/summary.js';

const peak = arrivalRate(config.production ? 120 : 360, 120);
const base = integer('BASE_RATE', 30, 1, config.production ? 120 : 1000000);
export const options = {
  ...commonOptions({
    ...baseThresholds(0.5),
    'http_req_duration{endpoint:GetAvailability,phase:workload}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{endpoint:GetWorkshopSchedule,phase:workload}': ['p(95)<500', 'p(99)<1000'],
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

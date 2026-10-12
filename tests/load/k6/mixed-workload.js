import { config, commonOptions, arrivalRate } from './lib/config.js';
import { discover, baseThresholds } from './lib/api.js';
import { mixedIteration, workloadThresholds, cancelLeftoverBookings } from './lib/workload.js';
import { summarize } from './lib/summary.js';

export const options = {
  ...commonOptions({ ...baseThresholds(), ...workloadThresholds() }),
  scenarios: {
    mixed: {
      executor: 'constant-arrival-rate', exec: 'mixed', timeUnit: '1m',
      rate: arrivalRate(config.production ? 10 : 30, 25), duration: __ENV.DURATION || '5m',
      preAllocatedVUs: config.preAllocatedVUs, maxVUs: config.maxVUs,
      gracefulStop: __ENV.GRACEFUL_STOP || '10s',
    },
  },
};
export const setup = () => discover();
export const mixed = mixedIteration;
export const teardown = cancelLeftoverBookings;
export const handleSummary = (data) => summarize('mixed-workload', data);

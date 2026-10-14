export function integer(name, fallback, min = 1, max = 1000000) {
  const value = Number(__ENV[name] === undefined ? fallback : __ENV[name]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

export function optionalInteger(name, fallback, min = 0, max = 1000000) {
  return __ENV[name] === undefined || __ENV[name] === '' ? fallback : integer(name, fallback, min, max);
}

export function fraction(name, fallback) {
  const value = Number(__ENV[name] === undefined ? fallback : __ENV[name]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be in [0, 1]`);
  }
  return value;
}

// Accept an origin only so credentials or paths cannot enter request tags or reports.
const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:5420').replace(/\/$/, '');
const origin = /^https?:\/\/(\[[0-9A-Fa-f:.]+\]|[^/:?#@[\]]+)(?::\d{1,5})?$/.exec(baseUrl);
if (!origin) throw new Error('BASE_URL must be an http(s) origin without credentials or a path');
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin[1]);
const rateEnvironment = __ENV.RATE_LIMIT_ENV || 'Development';
if (!['Development', 'Production'].includes(rateEnvironment)) {
  throw new Error('RATE_LIMIT_ENV must be Development or Production');
}
if (!local && (__ENV.REMOTE_APPROVED !== 'true' || rateEnvironment !== 'Production')) {
  throw new Error('Remote runs require explicit owner approval, REMOTE_APPROVED=true and RATE_LIMIT_ENV=Production');
}

export const config = {
  baseUrl,
  production: rateEnvironment === 'Production',
  rateEnvironment,
  dealershipId: __ENV.DEALERSHIP_ID,
  serviceCode: __ENV.SERVICE_CODE,
  firstDay: integer('DAY_OFFSET', 14, 2, 60),
  searchDays: integer('SEARCH_DAYS', 14, 1, 28),
  preAllocatedVUs: integer('PREALLOCATED_VUS', 10, 1),
  maxVUs: integer('MAX_VUS', 30, 1),
  retries: integer('RATE_LIMIT_RETRIES', 2, 0, 5),
  timeout: __ENV.REQUEST_TIMEOUT || '10s',
  summaryDir: __ENV.SUMMARY_DIR || 'tests/load/k6/results',
};
if (config.firstDay + config.searchDays > 88) throw new Error('Discovery must stay inside the 90-day horizon');
if (config.preAllocatedVUs > config.maxVUs) throw new Error('PREALLOCATED_VUS exceeds MAX_VUS');

export function arrivalRate(fallback, productionCeiling) {
  return integer('RATE', fallback, 1, config.production ? productionCeiling : 1000000);
}

export function commonOptions(thresholds) {
  return {
    setupTimeout: '3m',
    teardownTimeout: '3m',
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
    // Omit URLs, GUIDs and VINs from metric labels. Endpoint operation ids are stable.
    systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'check'],
    tags: { rate_environment: rateEnvironment },
    thresholds,
  };
}

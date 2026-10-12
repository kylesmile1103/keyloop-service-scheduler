import { config } from './config.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// run.sh selects the compatibility summary (--new-machine-readable-summary=false),
// whose metrics map carries each threshold's { ok } verdict. k6 v2's new
// results.metrics[] format has no verdicts; it is still accepted, with less
// evidence. Either way the k6 exit code is the authoritative verdict.
const exitCodes = 'The k6 exit code is authoritative: 0 passed, 99 a threshold failed, 108 aborted.';

function thresholdVerdicts(metrics) {
  return metrics.flatMap((metric) => Object.entries(metric.thresholds || {})
    .map(([expression, verdict]) => ({ metric: metric.name, expression, ok: verdict?.ok === true })))
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.metric.localeCompare(b.metric));
}

export function summarize(profile, data) {
  const metrics = data.results?.metrics || Object.entries(data.metrics || {}).map(([name, metric]) => ({ name, ...metric }));
  const thresholds = thresholdVerdicts(metrics);
  const failed = thresholds.filter((t) => !t.ok).length;
  const verdictLine = thresholds.length === 0
    ? `${profile}: this summary format has no threshold verdicts. ${exitCodes}`
    : `${profile}: ${thresholds.length - failed} thresholds passed, ${failed} failed. ${exitCodes}`;
  const report = {
    profile, baseUrl: config.baseUrl, rateLimitEnvironment: config.rateEnvironment,
    metadata: data.metadata || {},
    durationSeconds: data.config?.duration ?? (data.state?.testRunDurationMs / 1000),
    thresholds,
    metrics,
    checks: data.results?.checks || data.root_group,
    thresholdVerdict: exitCodes,
  };
  const verdictRows = thresholds.map((t) => `<tr><td>${t.ok ? 'PASS' : '<strong>FAIL</strong>'}</td><td>${escapeHtml(t.metric)}</td><td><code>${escapeHtml(t.expression)}</code></td></tr>`).join('\n');
  const rows = metrics.map((metric) => `<tr><td>${escapeHtml(metric.name)}</td><td>${escapeHtml(JSON.stringify(metric.labels || metric.tags || {}))}</td><td><code>${escapeHtml(JSON.stringify(metric.values))}</code></td><td>${escapeHtml(JSON.stringify(metric.thresholds || {}))}</td></tr>`).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Keyloop k6 ${escapeHtml(profile)}</title>
<style>body{font:16px system-ui;margin:2rem}table{border-collapse:collapse;margin-bottom:2rem}td,th{padding:.5rem;border:1px solid #aaa;text-align:left}code{white-space:pre-wrap}</style>
<h1>Keyloop k6 ${escapeHtml(profile)}</h1><p>${escapeHtml(config.baseUrl)} (${escapeHtml(config.rateEnvironment)})</p>
<p>${escapeHtml(verdictLine)}</p>
<h2>Thresholds</h2><table><thead><tr><th>Verdict</th><th>Metric</th><th>Threshold</th></tr></thead><tbody>${verdictRows}</tbody></table>
<h2>Metrics</h2><table><thead><tr><th>Metric</th><th>Labels</th><th>Values</th><th>Thresholds</th></tr></thead><tbody>${rows}</tbody></table></html>`;
  const important = metrics.filter((metric) => ['http_reqs', 'http_req_duration', 'http_req_failed',
    'booking_success', 'booking_conflicts', 'replayed', 'server_errors', 'rate_limited', 'retry_after_seconds',
    'lifecycle_completed', 'orphans_cancelled', 'contention_verified', 'contention_start_lag', 'checks',
    'dropped_iterations'].includes(metric.name));
  const verdictLines = thresholds.map((t) => `${t.ok ? 'PASS' : 'FAIL'} ${t.metric} ${t.expression}`);
  return {
    stdout: `${[verdictLine, ...verdictLines].join('\n')}\n\n${important.map((metric) => `${metric.name} ${JSON.stringify(metric.values)}`).join('\n')}\n`,
    [`${config.summaryDir}/${profile}.json`]: JSON.stringify(report, null, 2),
    [`${config.summaryDir}/${profile}.html`]: html,
  };
}

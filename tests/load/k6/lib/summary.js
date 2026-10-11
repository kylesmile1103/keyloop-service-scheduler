import { config } from './config.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function summarize(profile, data) {
  // k6 v2 uses results.metrics[], with fixed percentile keys such as p95.
  // Retain v1's map support
  // for tools that explicitly opt out of the new machine-readable summary.
  const metrics = data.results?.metrics || Object.entries(data.metrics || {}).map(([name, metric]) => ({ name, ...metric }));
  const report = {
    profile, baseUrl: config.baseUrl, rateLimitEnvironment: config.rateEnvironment,
    metadata: data.metadata || {},
    durationSeconds: data.config?.duration ?? (data.state?.testRunDurationMs / 1000),
    metrics,
    checks: data.results?.checks || data.root_group,
    // The process exit code is authoritative for thresholds. The v2 machine
    // summary does not include their verdicts. Never infer a pass from JSON.
    thresholdVerdict: 'Use the k6 process exit code; 0 passes, 99 fails thresholds.',
  };
  const rows = metrics.map((metric) => `<tr><td>${escapeHtml(metric.name)}</td><td>${escapeHtml(JSON.stringify(metric.labels || metric.tags || {}))}</td><td><code>${escapeHtml(JSON.stringify(metric.values))}</code></td><td>${escapeHtml(JSON.stringify(metric.thresholds || {}))}</td></tr>`).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Keyloop k6 ${escapeHtml(profile)}</title>
<style>body{font:16px system-ui;margin:2rem}table{border-collapse:collapse}td,th{padding:.5rem;border:1px solid #aaa;text-align:left}code{white-space:pre-wrap}</style>
<h1>Keyloop k6 ${escapeHtml(profile)}</h1><p>${escapeHtml(config.baseUrl)} (${escapeHtml(config.rateEnvironment)})</p>
<p>${escapeHtml(report.thresholdVerdict)}</p><table><thead><tr><th>Metric</th><th>Labels</th><th>Values</th><th>Thresholds</th></tr></thead><tbody>${rows}</tbody></table></html>`;
  const important = metrics.filter((metric) => ['http_reqs', 'http_req_duration', 'http_req_failed',
    'booking_success', 'booking_conflicts', 'replayed', 'server_errors', 'rate_limited', 'lifecycle_completed',
    'contention_verified', 'contention_start_lag', 'checks', 'dropped_iterations'].includes(metric.name));
  return {
    stdout: `${profile}: ${report.thresholdVerdict}\n${important.map((metric) => `${metric.name} ${JSON.stringify(metric.values)}`).join('\n')}\n`,
    [`${config.summaryDir}/${profile}.json`]: JSON.stringify(report, null, 2),
    [`${config.summaryDir}/${profile}.html`]: html,
  };
}

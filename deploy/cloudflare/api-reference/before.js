// Runs before Scalar's bundle. The Zod copy inside it probes for eval support with Function(""), which the site CSP
// (script-src 'self', no 'unsafe-eval') blocks and reports as a violation even though the probe catches the error.
// Jitless mode skips the probe and parses without generated code, so the page needs no CSP relaxation.
globalThis.__zod_globalConfig = { jitless: true }

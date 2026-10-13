// Enable Zod jitless mode before Scalar loads so the site CSP does not need 'unsafe-eval'.
globalThis.__zod_globalConfig = { jitless: true }

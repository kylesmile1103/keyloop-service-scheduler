// Mounts Scalar's standalone bundle (/scalar/standalone.js, @scalar/api-reference, MIT) on the committed contract. A file,
// not an inline script, because the site CSP allows only same-origin script files. Every option that would reach another
// origin is off: Scalar's font CDN, telemetry, the AI agent, MCP and the developer toolbar (dashboard and registry links).
// No proxy is set and the only server is this origin, so "Test Request" calls and the curl examples target this site:
// anonymous reads work, and writes need the Access session from /auth/login.
;(function () {
  var dark = false
  try {
    // Same storage key and rule as the board's theme (public/theme-init.js in the web project).
    var choice = localStorage.getItem("keyloop-scheduler-theme")
    dark = choice === "dark" || (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  } catch (_) {
    // Storage blocked: Scalar's own default applies.
  }
  Scalar.createApiReference("#keyloop-api-reference", {
    url: "/openapi/v1.json",
    // The contract declares no servers; without one the examples would show bare paths.
    servers: [{ url: window.location.origin, description: "This deployment" }],
    withDefaultFonts: false,
    telemetry: false,
    showDeveloperTools: "never",
    agent: { disabled: true },
    mcp: { disabled: true },
    persistAuth: false,
    darkMode: dark,
    // Matches the API's Development reference (Program.cs: curl snippets, operation IDs, all tags expanded).
    defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
    showOperationId: true,
    defaultOpenAllTags: true,
    documentDownloadType: "json",
  })
})()

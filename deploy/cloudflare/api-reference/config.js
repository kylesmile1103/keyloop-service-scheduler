// Mounts the standalone Scalar API reference against the committed OpenAPI contract without off-origin requests.
;(function () {
  var dark = false
  try {
    var choice = localStorage.getItem("keyloop-scheduler-theme")
    dark = choice === "dark" || (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  } catch (_) {
    // Storage blocked: Scalar's own default applies.
  }
  Scalar.createApiReference("#keyloop-api-reference", {
    url: "/openapi/v1.json",
    servers: [{ url: window.location.origin, description: "This deployment" }],
    withDefaultFonts: false,
    telemetry: false,
    showDeveloperTools: "never",
    agent: { disabled: true },
    mcp: { disabled: true },
    hideClientButton: true,
    persistAuth: false,
    darkMode: dark,
    defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
    showOperationId: true,
    defaultOpenAllTags: true,
    documentDownloadType: "json",
  })
})()

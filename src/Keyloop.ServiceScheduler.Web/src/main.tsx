// Adopted from shadcn-dashboard-landing-template (vite-version) `src/main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import "@fontsource-variable/plus-jakarta-sans/wght.css"
import "@fontsource-variable/ibm-plex-sans/wght.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { initTelemetry } from "@/lib/telemetry"

// Initialise telemetry before first render so initial API calls are traced.
await initTelemetry()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

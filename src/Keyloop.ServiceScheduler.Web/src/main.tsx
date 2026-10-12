// Adopted from shadcn-dashboard-landing-template (vite-version) `src/main.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import "@fontsource-variable/plus-jakarta-sans/wght.css"
import "@fontsource-variable/ibm-plex-sans/wght.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { initTelemetry } from "@/lib/telemetry"

// Before the first render, so the board's first API calls are traced. Resolves at once when tracing is off (every
// production build unless a collector is configured) and never rejects.
await initTelemetry()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

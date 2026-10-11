import "@fontsource-variable/inter"

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

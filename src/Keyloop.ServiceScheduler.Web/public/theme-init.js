// Runs before first paint: applies the theme ThemeProvider will apply (same storage key), so dark mode does not flash
// light on load. Kept in sync with src/components/theme-provider.tsx.
;(function () {
  try {
    var choice = localStorage.getItem("keyloop-scheduler-theme")
    var dark = choice === "dark" || (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.add(dark ? "dark" : "light")
  } catch (_) {
    // Storage blocked: ThemeProvider still applies the theme after the first render.
  }
})()

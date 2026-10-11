import { QueryClientProvider } from "@tanstack/react-query"
import { createBrowserRouter, RouterProvider } from "react-router-dom"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { appRoutes } from "@/config/routes"
import { queryClient } from "@/lib/query-client"

type AppRouter = ReturnType<typeof createBrowserRouter>

const browserRouter = createBrowserRouter(appRoutes)

/** Providers around the router. Tests pass a memory router; the app uses the browser router. */
function App({ router = browserRouter }: { router?: AppRouter }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="keyloop-scheduler-theme">
        <Toaster>
          <RouterProvider router={router} />
        </Toaster>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App

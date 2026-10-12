import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createBrowserRouter, RouterProvider } from "react-router-dom"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { appRoutes } from "@/config/routes"
// Registers the request id and error interceptors on the generated API client before any page calls the API.
import "@/lib/api-client"
import { queryClient as appQueryClient } from "@/lib/query-client"

type AppRouter = ReturnType<typeof createBrowserRouter>

const browserRouter = createBrowserRouter(appRoutes)

interface AppProps {
  /** Tests pass a memory router; the app uses the browser router. */
  router?: AppRouter
  /** Tests pass a fresh client so cached responses never leak between them. */
  queryClient?: QueryClient
}

/** Providers around the router. */
function App({ router = browserRouter, queryClient = appQueryClient }: AppProps) {
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

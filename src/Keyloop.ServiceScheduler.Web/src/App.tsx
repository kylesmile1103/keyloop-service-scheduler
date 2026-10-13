// Adopted from shadcn-dashboard-landing-template (vite-version) `src/App.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createBrowserRouter, RouterProvider } from "react-router-dom"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { appRoutes } from "@/config/routes"
// Side-effect import to register request-ID and error interceptors on the API client.
import "@/lib/api-client"
import { queryClient as appQueryClient } from "@/lib/query-client"

type AppRouter = ReturnType<typeof createBrowserRouter>

const browserRouter = createBrowserRouter(appRoutes)

interface AppProps {
  router?: AppRouter
  queryClient?: QueryClient
}

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

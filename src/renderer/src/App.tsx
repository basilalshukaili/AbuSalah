import { useEffect } from 'react'
import { Outlet, HashRouter, Route, Routes, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { useAppStore } from '@/stores/app-store'
import { Dashboard } from '@/routes/Dashboard'
import { NewInvoice } from '@/routes/NewInvoice'
import { SearchInvoices } from '@/routes/SearchInvoices'
import { Products } from '@/routes/Products'
import { Customers } from '@/routes/Customers'
import { Reports } from '@/routes/Reports'
import { Settings } from '@/routes/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false }
  }
})

function Layout() {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Boot() {
  const loadSettings = useAppStore((s) => s.loadSettings)
  const loading = useAppStore((s) => s.loading)
  const settings = useAppStore((s) => s.settings)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  if (loading || !settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    )
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="invoice/new" element={<NewInvoice />} />
          <Route path="search" element={<SearchInvoices />} />
          <Route path="products" element={<Products />} />
          <Route path="customers" element={<Customers />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Boot />
      <Toaster richColors position="top-center" closeButton />
    </QueryClientProvider>
  )
}

import { useEffect } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { MobileAuthGate } from '@/components/auth/MobileAuthGate'
import { MobileNav } from '@/components/layout/MobileNav'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { Customers } from '@/routes/Customers'
import { Dashboard } from '@/routes/Dashboard'
import { NewInvoice } from '@/routes/NewInvoice'
import { Products } from '@/routes/Products'
import { Reports } from '@/routes/Reports'
import { SearchInvoices } from '@/routes/SearchInvoices'
import { Settings } from '@/routes/Settings'
import { useAppStore } from '@/stores/app-store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false }
  }
})

function Layout() {
  return (
    <div className="flex h-dvh min-h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overscroll-contain overflow-y-auto overflow-x-hidden px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-4 md:p-6">
          <Outlet />
        </main>
        <MobileNav />
      </div>
    </div>
  )
}

function Boot() {
  const loadSettings = useAppStore((state) => state.loadSettings)
  const loading = useAppStore((state) => state.loading)
  const settings = useAppStore((state) => state.settings)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  if (loading || !settings) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
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
      <MobileAuthGate>
        <Boot />
      </MobileAuthGate>
      <Toaster richColors position="top-center" closeButton />
    </QueryClientProvider>
  )
}

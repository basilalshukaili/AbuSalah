import { FormEvent, ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { KeyRound, Loader2, RefreshCw, Smartphone, WifiOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getMobileAuthSnapshot,
  initializeMobileAuth,
  isMobileBrowser,
  mobileLogin,
  subscribeMobileAuth
} from '@/lib/api'

export function MobileAuthGate({ children }: { children: ReactNode }) {
  const auth = useSyncExternalStore(
    subscribeMobileAuth,
    getMobileAuthSnapshot,
    getMobileAuthSnapshot
  )
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isMobileBrowser) void initializeMobileAuth()
  }, [])

  if (!isMobileBrowser || auth.status === 'desktop' || auth.status === 'authenticated') {
    return <>{children}</>
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await mobileLogin(pin)
      setPin('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:grid sm:place-items-center">
      <Card className="mx-auto w-full max-w-md overflow-hidden">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow">
            {auth.status === 'offline' ? (
              <WifiOff className="h-7 w-7" />
            ) : (
              <Smartphone className="h-7 w-7" />
            )}
          </div>
          <div>
            <CardTitle className="text-2xl">Abu Salah Mobile</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">ابو صلاح على الهاتف</p>
          </div>
        </CardHeader>

        <CardContent>
          {auth.status === 'checking' ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p>Connecting to the PC…</p>
            </div>
          ) : auth.status === 'offline' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                {auth.message ||
                  'Open Abu Salah on the PC and make sure the phone is connected to the same Wi-Fi.'}
              </p>
              <p className="text-sm text-muted-foreground" dir="rtl">
                افتح برنامج ابو صلاح على الكمبيوتر وتأكد أن الهاتف على نفس شبكة الواي فاي.
              </p>
              <Button className="w-full" onClick={() => void initializeMobileAuth()}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="mobile-pin" className="text-base">
                  Access PIN · رمز الدخول
                </Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="mobile-pin"
                    autoFocus
                    autoComplete="one-time-code"
                    className="h-14 ps-11 text-center font-mono text-2xl tracking-[0.3em]"
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]*"
                    placeholder="••••••"
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter the PIN shown under Settings → Mobile access on the PC.
                </p>
              </div>

              {(error || auth.message) && (
                <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error || auth.message}
                </p>
              )}

              <Button className="w-full" size="lg" disabled={submitting || pin.length !== 6}>
                {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
                Connect · دخول
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {window.location.host}
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

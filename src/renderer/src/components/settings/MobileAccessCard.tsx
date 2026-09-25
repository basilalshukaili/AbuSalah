import { useEffect, useState } from 'react'
import {
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Smartphone,
  Wifi
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isMobileBrowser, mobileLogout } from '@/lib/api'
import type { MobileAccessInfo } from '@shared/types'

const copyFor = {
  en: {
    title: 'Mobile access',
    connected: 'This phone is connected to the PC on the local Wi-Fi.',
    logout: 'Disconnect this phone',
    pcHint: 'Keep Abu Salah open, then enter one of these addresses on a phone connected to the same Wi-Fi.',
    pin: 'Access PIN',
    sessions: 'Connected phones',
    rotate: 'New PIN',
    rotateConfirm: 'Create a new PIN? All currently connected phones will be signed out.',
    copied: 'Copied',
    unavailable: 'Mobile access is not available.'
  },
  ar: {
    title: 'الدخول من الهاتف',
    connected: 'هذا الهاتف متصل بالكمبيوتر عبر شبكة الواي فاي المحلية.',
    logout: 'فصل هذا الهاتف',
    pcHint: 'اترك برنامج ابو صلاح مفتوحاً، ثم افتح أحد هذه العناوين من هاتف على نفس شبكة الواي فاي.',
    pin: 'رمز الدخول',
    sessions: 'الهواتف المتصلة',
    rotate: 'رمز جديد',
    rotateConfirm: 'هل تريد إنشاء رمز جديد؟ سيتم فصل جميع الهواتف المتصلة حالياً.',
    copied: 'تم النسخ',
    unavailable: 'الدخول من الهاتف غير متاح.'
  }
}

export function MobileAccessCard() {
  const { i18n } = useTranslation()
  const text = i18n.language === 'ar' ? copyFor.ar : copyFor.en
  const [info, setInfo] = useState<MobileAccessInfo | null>(null)
  const [loading, setLoading] = useState(!isMobileBrowser)
  const [rotating, setRotating] = useState(false)
  const [error, setError] = useState('')

  async function loadInfo() {
    if (isMobileBrowser) return
    setLoading(true)
    setError('')
    try {
      setInfo(await window.api.mobileAccessInfo())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : text.unavailable)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInfo()
    // The language switch should not restart or rotate the LAN server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(text.copied)
    } catch {
      toast.error('Copy failed')
    }
  }

  async function rotatePin() {
    if (!window.confirm(text.rotateConfirm)) return
    setRotating(true)
    setError('')
    try {
      setInfo(await window.api.mobileAccessRotatePin())
      toast.success(text.rotate)
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : text.unavailable)
    } finally {
      setRotating(false)
    }
  }

  if (isMobileBrowser) {
    return (
      <Card className="border-success/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-success" />
            {text.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-success/10 p-4 text-success">
            <Check className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">{text.connected}</p>
              <p className="mt-1 truncate font-mono text-xs" dir="ltr">
                {window.location.host}
              </p>
            </div>
          </div>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => void mobileLogout()}>
            <LogOut className="h-4 w-4" />
            {text.logout}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-primary" />
          {text.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex min-h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
            <Button variant="outline" onClick={() => void loadInfo()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : !info?.enabled ? (
          <p className="text-sm text-muted-foreground">{text.unavailable}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{text.pcHint}</p>

            <div className="grid gap-2">
              {info.urls.map((url) => (
                <div key={url} className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/30 p-2">
                  <a
                    className="min-w-0 flex-1 truncate px-2 font-mono text-sm text-primary underline-offset-4 hover:underline"
                    dir="ltr"
                    href={url}
                  >
                    {url}
                  </a>
                  <Button variant="ghost" size="icon" onClick={() => void copy(url)} aria-label="Copy URL">
                    <Clipboard className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <KeyRound className="h-4 w-4" />
                  {text.pin}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-3xl font-bold tracking-[0.22em]" dir="ltr">
                    {info.pin}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => void copy(info.pin)} aria-label="Copy PIN">
                    <Clipboard className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="text-sm text-muted-foreground">{text.sessions}</div>
                <div className="mt-2 text-3xl font-bold">{info.sessionCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Port {info.port}</div>
              </div>
            </div>

            <Button variant="outline" className="w-full sm:w-auto" disabled={rotating} onClick={() => void rotatePin()}>
              {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {text.rotate}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

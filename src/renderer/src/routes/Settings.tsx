import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Database, Download, Languages, Palette, RefreshCw, Save, Type, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { MobileAccessCard } from '@/components/settings/MobileAccessCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isMobileBrowser } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type { Settings as SettingsT } from '@shared/types'

export function Settings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [draft, setDraft] = useState<Partial<SettingsT>>({})

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  function set<K extends keyof SettingsT>(key: K, value: SettingsT[K]) {
    setDraft({ ...draft, [key]: value })
  }

  async function save() {
    try {
      await updateSettings(draft)
      toast.success(t('msg.settingsSaved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function backupNow() {
    try {
      const path = await window.api.backupCreate('manual')
      toast.success(t('msg.backupDone'), { description: path })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function importLegacy() {
    try {
      const hasLegacyFiles = await window.api.legacyHasFiles()
      if (!hasLegacyFiles) {
        toast.warning(t('msg.noLegacyData'))
        return
      }
      const result = await window.api.legacyImport()
      toast.success(
        t('msg.importDone', { products: result.products, invoices: result.invoices })
      )
      queryClient.invalidateQueries()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  if (!draft.theme) return null

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('settings.title')}</h1>

      <MobileAccessCard />

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            {t('settings.appearance')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 p-4 pt-0 sm:p-6 sm:pt-0 md:grid-cols-3">
          <div>
            <Label className="mb-2 flex items-center gap-1.5">
              <Languages className="h-4 w-4" />
              {t('settings.language')}
            </Label>
            <Select value={draft.language ?? 'en'} onValueChange={(value) => set('language', value as 'en' | 'ar')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-2 flex items-center gap-1.5">
              <Palette className="h-4 w-4" />
              {t('settings.theme')}
            </Label>
            <Select value={draft.theme ?? 'light'} onValueChange={(value) => set('theme', value as 'light' | 'dark')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
                <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-2 flex items-center gap-1.5">
              <Type className="h-4 w-4" />
              {t('settings.fontSize')}
            </Label>
            <Input
              type="range"
              min={14}
              max={28}
              value={draft.fontSize ?? 16}
              onChange={(event) => set('fontSize', Number(event.target.value))}
            />
            <div className="mt-1 text-xs text-muted-foreground">{draft.fontSize ?? 16} px</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>{t('settings.business')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 p-4 pt-0 sm:p-6 sm:pt-0 md:grid-cols-2">
          <div>
            <Label>{t('settings.businessName')}</Label>
            <Input
              value={draft.businessName ?? ''}
              onChange={(event) => set('businessName', event.target.value)}
            />
          </div>
          <div>
            <Label>{t('settings.businessNameAr')}</Label>
            <Input
              dir="rtl"
              value={draft.businessNameAr ?? ''}
              onChange={(event) => set('businessNameAr', event.target.value)}
            />
          </div>
          <div>
            <Label>{t('settings.businessPhone')}</Label>
            <Input
              inputMode="tel"
              value={draft.businessPhone ?? ''}
              onChange={(event) => set('businessPhone', event.target.value)}
            />
          </div>
          <div>
            <Label>{t('settings.taxRate')}</Label>
            <Input
              inputMode="decimal"
              value={String(((draft.taxRate ?? 0.05) * 100).toFixed(2))}
              onChange={(event) => set('taxRate', Math.max(0, Number(event.target.value) || 0) / 100)}
            />
          </div>
          <div>
            <Label>{t('settings.businessEmail')}</Label>
            <Input
              type="email"
              value={draft.businessEmail ?? ''}
              onChange={(event) => set('businessEmail', event.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div className="md:col-span-2">
            <Label>{t('settings.businessAddress')}</Label>
            <Input
              value={draft.businessAddress ?? ''}
              onChange={(event) => set('businessAddress', event.target.value)}
              placeholder="Sultanate of Oman, Nizwa"
            />
          </div>
        </CardContent>
      </Card>

      {!isMobileBrowser && (
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              {t('settings.data')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4 pt-0 sm:flex-row sm:flex-wrap sm:p-6 sm:pt-0">
            <Button className="w-full sm:w-auto" onClick={backupNow} variant="outline">
              <Download className="h-4 w-4" />
              {t('settings.backupNow')}
            </Button>
            <Button className="w-full sm:w-auto" onClick={importLegacy} variant="outline">
              <Upload className="h-4 w-4" />
              {t('settings.importLegacy')}
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => window.api.appReload()} variant="ghost">
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button className="w-full sm:w-auto" size="lg" onClick={save} variant="success">
          <Save className="h-5 w-5" />
          {t('settings.save')}
        </Button>
      </div>
    </div>
  )
}

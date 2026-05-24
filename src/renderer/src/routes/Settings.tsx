import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Database, Download, Languages, Palette, RefreshCw, Save, Type, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/stores/app-store'
import type { Settings as SettingsT } from '@shared/types'

export function Settings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function backupNow() {
    try {
      const path = await window.api.backupCreate('manual')
      toast.success(t('msg.backupDone'), { description: path })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function importLegacy() {
    try {
      const has = await window.api.legacyHasFiles()
      if (!has) {
        toast.warning(t('msg.noLegacyData'))
        return
      }
      const result = await window.api.legacyImport()
      toast.success(
        t('msg.importDone', { products: result.products, invoices: result.invoices })
      )
      qc.invalidateQueries()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (!draft.theme) return null

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            {t('settings.appearance')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="flex items-center gap-1.5 mb-2">
              <Languages className="h-4 w-4" />
              {t('settings.language')}
            </Label>
            <Select value={draft.language ?? 'en'} onValueChange={(v) => set('language', v as 'en' | 'ar')}>
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
            <Label className="flex items-center gap-1.5 mb-2">
              <Palette className="h-4 w-4" />
              {t('settings.theme')}
            </Label>
            <Select value={draft.theme ?? 'light'} onValueChange={(v) => set('theme', v as 'light' | 'dark')}>
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
            <Label className="flex items-center gap-1.5 mb-2">
              <Type className="h-4 w-4" />
              {t('settings.fontSize')}
            </Label>
            <Input
              type="range"
              min={14}
              max={28}
              value={draft.fontSize ?? 16}
              onChange={(e) => set('fontSize', Number(e.target.value))}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {draft.fontSize ?? 16} px
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.business')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>{t('settings.businessName')}</Label>
            <Input
              value={draft.businessName ?? ''}
              onChange={(e) => set('businessName', e.target.value)}
            />
          </div>
          <div>
            <Label>{t('settings.businessNameAr')}</Label>
            <Input
              dir="rtl"
              value={draft.businessNameAr ?? ''}
              onChange={(e) => set('businessNameAr', e.target.value)}
            />
          </div>
          <div>
            <Label>{t('settings.businessPhone')}</Label>
            <Input
              value={draft.businessPhone ?? ''}
              onChange={(e) => set('businessPhone', e.target.value)}
            />
          </div>
          <div>
            <Label>{t('settings.taxRate')}</Label>
            <Input
              inputMode="decimal"
              value={String(((draft.taxRate ?? 0.05) * 100).toFixed(2))}
              onChange={(e) => set('taxRate', Math.max(0, Number(e.target.value) || 0) / 100)}
            />
          </div>
          <div>
            <Label>{t('settings.businessEmail')}</Label>
            <Input
              type="email"
              value={draft.businessEmail ?? ''}
              onChange={(e) => set('businessEmail', e.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div className="md:col-span-2">
            <Label>{t('settings.businessAddress')}</Label>
            <Input
              value={draft.businessAddress ?? ''}
              onChange={(e) => set('businessAddress', e.target.value)}
              placeholder="Sultanate of Oman, Nizwa&#10;P.O Box 1291, Code 611"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {t('settings.data')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={backupNow} variant="outline">
            <Download className="h-4 w-4" />
            {t('settings.backupNow')}
          </Button>
          <Button onClick={importLegacy} variant="outline">
            <Upload className="h-4 w-4" />
            {t('settings.importLegacy')}
          </Button>
          <Button onClick={() => window.api.appReload()} variant="ghost">
            <RefreshCw className="h-4 w-4" />
            Reload
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={save} variant="success">
          <Save className="h-5 w-5" />
          {t('settings.save')}
        </Button>
      </div>
    </div>
  )
}

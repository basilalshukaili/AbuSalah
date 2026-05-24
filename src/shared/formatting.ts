/** Money/format helpers shared between processes (no DOM/Electron deps). */

export function formatMoney(value: number, decimals = 3, currency = 'OMR'): string {
  const v = Number.isFinite(value) ? value : 0
  return `${v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} ${currency}`
}

export function roundMoney(value: number, decimals = 3): number {
  const f = 10 ** decimals
  return Math.round((Number.isFinite(value) ? value : 0) * f) / f
}

export function normalizePhone(phone: string): string {
  if (!phone) return ''
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D+/g, '')
  }
  return trimmed.replace(/\D+/g, '')
}

const ARABIC_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

export function hasArabic(text: string): boolean {
  return Boolean(text) && ARABIC_REGEX.test(text)
}

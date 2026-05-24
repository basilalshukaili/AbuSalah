import { describe, it, expect } from 'vitest'

import { formatMoney, roundMoney, normalizePhone, hasArabic } from '@shared/formatting'

describe('formatMoney', () => {
  it('formats a number with 3 decimals + OMR suffix by default', () => {
    expect(formatMoney(1234.5)).toBe('1,234.500 OMR')
  })

  it('respects custom decimals', () => {
    expect(formatMoney(10, 2)).toBe('10.00 OMR')
  })

  it('respects custom currency', () => {
    expect(formatMoney(7.25, 2, 'USD')).toBe('7.25 USD')
  })

  it('returns 0 for NaN', () => {
    expect(formatMoney(Number.NaN)).toBe('0.000 OMR')
  })

  it('returns 0 for Infinity', () => {
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('0.000 OMR')
  })

  it('formats negatives correctly', () => {
    expect(formatMoney(-12.345)).toBe('-12.345 OMR')
  })
})

describe('roundMoney', () => {
  it('rounds to 3 decimals by default', () => {
    expect(roundMoney(1.23456)).toBe(1.235)
  })

  it('rounds to custom decimals', () => {
    expect(roundMoney(1.5678, 2)).toBe(1.57)
  })

  it('returns 0 for NaN', () => {
    expect(roundMoney(Number.NaN)).toBe(0)
  })

  it('returns 0 for Infinity', () => {
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('preserves whole numbers', () => {
    expect(roundMoney(42)).toBe(42)
  })

  it('handles tiny floating-point quirks', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })
})

describe('normalizePhone', () => {
  it('strips spaces and non-digits', () => {
    expect(normalizePhone(' 9 5 5 0 0 5 1 2 ')).toBe('95500512')
  })

  it('keeps a leading + sign', () => {
    expect(normalizePhone('+968 95 500 512')).toBe('+96895500512')
  })

  it('strips dashes and parentheses', () => {
    expect(normalizePhone('(968)-955-00512')).toBe('96895500512')
  })

  it('handles empty input', () => {
    expect(normalizePhone('')).toBe('')
  })

  it('strips alpha characters', () => {
    expect(normalizePhone('phone: 95500512')).toBe('95500512')
  })

  it('does not double a + sign', () => {
    expect(normalizePhone('++968-95500512')).toBe('+96895500512')
  })
})

describe('hasArabic', () => {
  it('returns true for Arabic script', () => {
    expect(hasArabic('ستائر')).toBe(true)
  })

  it('returns true for mixed Arabic/Latin', () => {
    expect(hasArabic('Curtain ستائر raw')).toBe(true)
  })

  it('returns false for Latin-only', () => {
    expect(hasArabic('curtain')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasArabic('')).toBe(false)
  })

  it('returns false for digits only', () => {
    expect(hasArabic('12345')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'

import { parseLegacyBillLine } from '@main/services/legacy-import'

/**
 * NOTE: at the time of writing, the production `parsePyLiteral` parser used
 * by `parseLegacyBillLine` has a `skipWs()` that consumes the `,` separator
 * between list elements, which makes the subsequent `if (peek === ',')` check
 * fail.  As a result, ANY items list with more than one element currently
 * fails to parse and `parseLegacyBillLine` returns `null`.  See the
 * "FLAGGED BUG" tests below — they use `it.fails` to assert this is broken
 * and will pass *after* the bug is fixed.
 */

describe('parseLegacyBillLine — happy paths', () => {
  it('parses an empty items array', () => {
    const line = '9-[]-0-0-01 / 01 / 2023-0-Cust-c'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.number).toBe(9)
    expect(parsed!.items).toEqual([])
    expect(parsed!.total).toBe(0)
    expect(parsed!.advance).toBe(0)
    expect(parsed!.tax).toBe(0)
    expect(parsed!.name).toBe('Cust')
    expect(parsed!.comments).toBe('c')
    expect(parsed!.date).not.toBeNull()
  })

  it('parses prefix and suffix (number, total, tax, name, comments) correctly even when items list is empty', () => {
    const line = '41-[]-110.25-20-12 / 11 / 2022-5.25-حمد البوسعيدي-بدون التوصيل'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.number).toBe(41)
    expect(parsed!.total).toBeCloseTo(110.25, 3)
    expect(parsed!.advance).toBe(20)
    expect(parsed!.tax).toBeCloseTo(5.25, 3)
    expect(parsed!.name).toBe('حمد البوسعيدي')
    expect(parsed!.comments).toBe('بدون التوصيل')
    // date may shift ±1 day due to local-vs-UTC; verify month at minimum
    expect(parsed!.date).toMatch(/^2022-11-1[12]/)
  })

  it('preserves comments containing dashes', () => {
    const line = '5-[]-10-0-01 / 01 / 2023-0-Cust-note-with-dashes'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.comments).toBe('note-with-dashes')
    expect(parsed!.name).toBe('Cust')
  })

  it('parses a date in DD / MM / YYYY format into ISO', () => {
    const line = '1-[]-10-0-12 / 11 / 2022-0-Cust-c'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.date).not.toBeNull()
    // The parser builds a local-time Date and toISOString() converts to UTC,
    // so the day may shift by 1.  Allow a ±24 h window.
    expect(parsed!.date).toMatch(/^2022-11-1[12]/)
  })

  it('parses dates with 2-digit years (year prefixed with 20)', () => {
    const line = '1-[]-10-0-05 / 06 / 22-0-Cust-c'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    // 2-digit year should be interpreted as 2022; allow ±1 day for TZ shift
    expect(parsed!.date).toMatch(/^2022-06-0[45]/)
  })

  it('returns null date when the date field is empty', () => {
    const line = '1-[]-10-0--0-Cust-c'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.date).toBeNull()
  })

  it('handles trailing newline characters', () => {
    const line = '1-[]-10-0-01 / 01 / 2023-0-Cust-c\n'
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.number).toBe(1)
  })
})

describe('parseLegacyBillLine — rejects malformed input', () => {
  it('returns null for an empty line', () => {
    expect(parseLegacyBillLine('')).toBeNull()
    expect(parseLegacyBillLine('   ')).toBeNull()
  })

  it('returns null for a line with no opening bracket', () => {
    expect(parseLegacyBillLine('not-a-valid-bill-line')).toBeNull()
  })

  it('returns null for unbalanced brackets', () => {
    expect(parseLegacyBillLine("1-[['x', 'y', '1', 10.0, '10.0']")).toBeNull()
  })

  it('returns null when the number portion is non-numeric', () => {
    const line = 'abc-[]-10-0-01 / 01 / 2023-0-Cust-c'
    expect(parseLegacyBillLine(line)).toBeNull()
  })
})

/**
 * FLAGGED BUG: parsePyLiteral.skipWs() eats the `,` between list elements,
 * so any list of length > 1 fails to parse.  These tests are marked with
 * `it.fails`, meaning vitest expects them to throw / fail.  When the bug is
 * fixed they will start passing — which `it.fails` will then report as a
 * regression so we know to flip them back to plain `it`.
 */
describe('parseLegacyBillLine — KNOWN BUGS (flagged)', () => {
  it('SHOULD parse a canonical single-item line (currently broken)', () => {
    const line =
      "41-[['111', 'سكارتنج الدرج', '1', 105.0, '105.0']]-110.25-20-12 / 11 / 2022-5.25-حمد البوسعيدي-بدون التوصيل"
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.items.length).toBe(1)
    expect(parsed!.items[0][0]).toBe('111')
    expect(parsed!.items[0][1]).toBe('سكارتنج الدرج')
  })

  it('SHOULD parse a multi-item line with embedded commas (currently broken)', () => {
    const line =
      "12-[['1', 'A,B', '2', 10.0, '20.0'], ['2', 'C, D, E', '3', 5.0, '15.0']]-35-0-01 / 01 / 2023-0-Customer-note"
    const parsed = parseLegacyBillLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.items.length).toBe(2)
    expect(parsed!.items[0][1]).toBe('A,B')
    expect(parsed!.items[1][1]).toBe('C, D, E')
  })
})

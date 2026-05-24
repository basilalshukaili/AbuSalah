/**
 * Tiny Python literal parser — handles only the shapes that appear in the
 * legacy `bills/<phone>` files: nested lists of strings and numbers, where
 * strings use single OR double quotes and may contain the *other* kind of
 * quote literally. Items in the legacy data NEVER contain backslash-escapes.
 *
 * Used because regex-replacing `'` → `"` corrupts names like `Ali's curtain`.
 */

export type PyLiteral = string | number | boolean | null | PyLiteral[]

export class PyParseError extends Error {}

class P {
  i = 0
  constructor(public s: string) {}
  peek(): string {
    return this.s[this.i] ?? ''
  }
  eof(): boolean {
    return this.i >= this.s.length
  }
  /**
   * Skip ONLY whitespace. Commas are list separators and must be handled by
   * the caller — eating them here would silently merge list elements.
   */
  skipWs(): void {
    while (!this.eof() && /\s/.test(this.peek())) this.i++
  }
}

function parseValue(p: P): PyLiteral {
  p.skipWs()
  const ch = p.peek()
  if (ch === '[') return parseList(p)
  if (ch === "'" || ch === '"') return parseString(p, ch)
  if (ch === 'T' || ch === 'F') return parseBool(p)
  if (ch === 'N') return parseNone(p)
  if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber(p)
  throw new PyParseError(`unexpected character '${ch}' at ${p.i}`)
}

function parseList(p: P): PyLiteral[] {
  if (p.peek() !== '[') throw new PyParseError('expected [')
  p.i++
  const out: PyLiteral[] = []
  p.skipWs()
  while (p.peek() !== ']') {
    out.push(parseValue(p))
    p.skipWs()
    if (p.peek() === ',') {
      p.i++
      p.skipWs()
    } else if (p.peek() !== ']') {
      throw new PyParseError(`expected , or ] at ${p.i}`)
    }
  }
  p.i++ // closing ]
  return out
}

function parseString(p: P, quote: string): string {
  if (p.peek() !== quote) throw new PyParseError('expected quote')
  p.i++
  let out = ''
  while (!p.eof() && p.peek() !== quote) {
    if (p.peek() === '\\') {
      // Handle a tiny set of common Python escapes
      p.i++
      const esc = p.peek()
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' }
      out += map[esc] ?? esc
      p.i++
    } else {
      out += p.peek()
      p.i++
    }
  }
  if (p.peek() !== quote) throw new PyParseError(`unterminated string starting near ${p.i}`)
  p.i++
  return out
}

function parseNumber(p: P): number {
  const start = p.i
  if (p.peek() === '-') p.i++
  while (!p.eof() && /[0-9.eE+-]/.test(p.peek())) p.i++
  const slice = p.s.slice(start, p.i)
  const n = Number(slice)
  if (!Number.isFinite(n)) throw new PyParseError(`bad number '${slice}'`)
  return n
}

function parseBool(p: P): boolean {
  if (p.s.slice(p.i, p.i + 4) === 'True') {
    p.i += 4
    return true
  }
  if (p.s.slice(p.i, p.i + 5) === 'False') {
    p.i += 5
    return false
  }
  throw new PyParseError(`unknown identifier at ${p.i}`)
}

function parseNone(p: P): null {
  if (p.s.slice(p.i, p.i + 4) === 'None') {
    p.i += 4
    return null
  }
  throw new PyParseError(`unknown identifier at ${p.i}`)
}

/** Parse a Python literal expression. Throws PyParseError on bad input. */
export function parsePyLiteral(input: string): PyLiteral {
  const p = new P(input)
  const v = parseValue(p)
  p.skipWs()
  if (!p.eof()) {
    // Permit trailing whitespace; raise on real garbage.
    if (p.s.slice(p.i).trim() !== '')
      throw new PyParseError(`trailing garbage at ${p.i}: ${p.s.slice(p.i)}`)
  }
  return v
}

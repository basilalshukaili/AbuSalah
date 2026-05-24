import { parsePyLiteral, PyParseError } from '../src/main/services/python-literal'
import { parseLegacyBillLine } from '../src/main/services/legacy-import'
import { readFileSync } from 'node:fs'

const path = String.raw`C:\Users\basil\Share\Abu Salah\bills\95500512`
const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter((l) => l.trim())

console.log(`File has ${lines.length} lines`)
console.log('--- LINE 1 ---')
console.log(lines[0])
console.log('--- PARSE ---')
const p = parseLegacyBillLine(lines[0])
console.log(JSON.stringify(p, null, 2))

const itemsRepr = "[['111', 'سكارتنج الدرج حسب النوع والسعر', '1', 105.0, '105.0']]"
console.log('--- python literal ---')
try {
  const v = parsePyLiteral(itemsRepr)
  console.log(JSON.stringify(v))
} catch (e) {
  if (e instanceof PyParseError) console.log('PyParseError:', e.message)
  else throw e
}

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | Readonly<{ [key: string]: CanonicalJsonValue }>

const PYTHON_STRIP_CODE_POINTS = new Set([
  0x0020,
  0x0085,
  0x00a0,
  0x1680,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
])

function isPythonStripWhitespace(character: string): boolean {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return false
  return (
    (codePoint >= 0x0009 && codePoint <= 0x000d) ||
    (codePoint >= 0x001c && codePoint <= 0x001f) ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    PYTHON_STRIP_CODE_POINTS.has(codePoint)
  )
}

/**
 * Mirrors CPython 3.10 `str.strip()` for Unicode whitespace. In particular,
 * U+FEFF is preserved even though JavaScript `String.prototype.trim()` removes
 * it. Interior characters, including LF and CRLF sequences, are never changed.
 */
export function pythonUnicodeStrip(value: string): string {
  const characters = Array.from(value)
  let start = 0
  let end = characters.length
  while (start < end && isPythonStripWhitespace(characters[start])) start += 1
  while (end > start && isPythonStripWhitespace(characters[end - 1])) end -= 1
  return characters.slice(start, end).join('')
}

export interface MarketingAdviceInputText {
  readonly productInfo: string
  readonly productShortName: string
  readonly creativeNote: string
}

export function normalizeMarketingAdviceInput(
  input: MarketingAdviceInputText,
): MarketingAdviceInputText {
  return {
    productInfo: pythonUnicodeStrip(input.productInfo),
    productShortName: pythonUnicodeStrip(input.productShortName),
    creativeNote: pythonUnicodeStrip(input.creativeNote),
  }
}

function assertScalarUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('Canonical JSON rejects unpaired Unicode surrogates.')
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Canonical JSON rejects unpaired Unicode surrogates.')
    }
  }
}

function canonicalize(
  value: unknown,
  ancestors: ReadonlySet<object>,
): CanonicalJsonValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    assertScalarUnicode(value)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON rejects non-finite numbers.')
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError('Canonical JSON rejects cyclic values.')
    }
    const nested = new Set(ancestors)
    nested.add(value)
    return value.map((item) => canonicalize(item, nested))
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON accepts only plain objects and arrays.')
    }
    if (ancestors.has(value)) {
      throw new TypeError('Canonical JSON rejects cyclic values.')
    }
    const nested = new Set(ancestors)
    nested.add(value)
    const source = value as Record<string, unknown>
    const result: Record<string, CanonicalJsonValue> = {}
    for (const key of Object.keys(source).sort()) {
      assertScalarUnicode(key)
      result[key] = canonicalize(source[key], nested)
    }
    return result
  }
  throw new TypeError(`Canonical JSON rejects values of type ${typeof value}.`)
}

/**
 * Strict canonical JSON for Workflow V2: recursively sorted object keys,
 * preserved array order, compact JSON, unescaped Unicode, and finite numbers.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()))
}

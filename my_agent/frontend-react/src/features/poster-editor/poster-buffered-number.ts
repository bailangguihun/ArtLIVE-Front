export interface PosterBufferedNumberSpec {
  readonly minimum: number
  readonly maximum: number
  readonly step: number
  readonly allowNegative?: boolean
}

export type PosterBufferedNumberParse =
  | { readonly kind: 'empty' | 'incomplete' | 'invalid' }
  | { readonly kind: 'out_of_range'; readonly value: number }
  | { readonly kind: 'valid'; readonly value: number }

function decimalPattern() {
  return /^-?(?:\d+|\d*\.\d+)$/
}

function incompletePattern() {
  return /^(?:-|-?\.|-?\d+\.)$/
}

export function parsePosterBufferedNumber(
  input: string,
  spec: PosterBufferedNumberSpec,
): PosterBufferedNumberParse {
  const value = input.trim()
  if (!value) return { kind: 'empty' }
  if (incompletePattern().test(value)) return { kind: 'incomplete' }
  if (!decimalPattern().test(value)) return { kind: 'invalid' }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return { kind: 'invalid' }
  if (parsed < spec.minimum || parsed > spec.maximum) {
    return { kind: 'out_of_range', value: parsed }
  }
  return { kind: 'valid', value: Object.is(parsed, -0) ? 0 : parsed }
}

export function formatPosterBufferedNumber(value: number) {
  return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : ''
}

export function stepPosterBufferedNumber(
  value: number,
  direction: 1 | -1,
  spec: PosterBufferedNumberSpec,
) {
  const next = value + direction * spec.step
  const rounded = Math.round(next * 1e12) / 1e12
  return Math.min(spec.maximum, Math.max(spec.minimum, rounded))
}

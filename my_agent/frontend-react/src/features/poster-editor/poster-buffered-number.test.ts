import { describe, expect, it } from 'vitest'
import {
  formatPosterBufferedNumber,
  parsePosterBufferedNumber,
  stepPosterBufferedNumber,
} from './poster-buffered-number'

const coordinate = { minimum: 0, maximum: 1, step: 0.01 } as const
const lineSize = { minimum: -1, maximum: 1, step: 0.01, allowNegative: true } as const

describe('poster buffered numeric parsing', () => {
  it.each([
    ['0', 'valid'],
    ['1', 'valid'],
    ['0.', 'incomplete'],
    ['.5', 'valid'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['-', 'incomplete'],
    ['Infinity', 'invalid'],
    ['1e3', 'invalid'],
    ['words', 'invalid'],
    ['-0.5', 'out_of_range'],
    ['1.00001', 'out_of_range'],
  ])('classifies %s safely as %s', (input, kind) => {
    expect(parsePosterBufferedNumber(input, coordinate).kind).toBe(kind)
  })

  it('accepts leading minus only for a field whose canonical range permits it', () => {
    expect(parsePosterBufferedNumber('-', lineSize).kind).toBe('incomplete')
    expect(parsePosterBufferedNumber('-.5', lineSize)).toEqual({ kind: 'valid', value: -0.5 })
  })

  it('keeps accepted decimal precision and steps finite values without float drift', () => {
    expect(parsePosterBufferedNumber('0.123456', coordinate)).toEqual({ kind: 'valid', value: 0.123456 })
    expect(stepPosterBufferedNumber(0.3, 1, coordinate)).toBe(0.31)
    expect(stepPosterBufferedNumber(0, -1, coordinate)).toBe(0)
    expect(stepPosterBufferedNumber(1, 1, coordinate)).toBe(1)
    expect(formatPosterBufferedNumber(-0)).toBe('0')
  })
})

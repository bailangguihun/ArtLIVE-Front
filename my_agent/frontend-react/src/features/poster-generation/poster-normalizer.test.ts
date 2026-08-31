import { describe, expect, it } from 'vitest'
import {
  isEligibleReadySlot,
  isTerminalSequenceStatus,
  normalizeSequenceResult,
  safeRelativeApiUrl,
} from './poster-normalizer'
import {
  normalizedSequence,
  sequenceDocument,
  TEST_POSTER_IDS,
} from './poster-test-utils'

describe('poster sequence normalization', () => {
  it.each([
    ['queued', false],
    ['running', false],
    ['completed', true],
    ['failed', true],
    ['partial_failed', true],
    ['interrupted', true],
    ['future_status', false],
  ])('normalizes overall %s and terminal semantics', (status, terminal) => {
    const normalized = normalizedSequence(status)
    expect(isTerminalSequenceStatus(normalized.status)).toBe(terminal)
    expect(normalized.status).toBe(
      status === 'future_status' ? 'unknown' : status,
    )
  })

  it.each([
    ['waiting', 'waiting'],
    ['generating', 'generating'],
    ['ready', 'ready'],
    ['failed', 'failed'],
    ['blocked', 'blocked'],
    ['future_slot', 'unknown'],
  ])('normalizes slot status %s without defaulting to ready', (raw, expected) => {
    const result = normalizedSequence('running', [raw, 'waiting', 'waiting'])
    expect(result.posters[0].status).toBe(expected)
    expect(isEligibleReadySlot(result.posters[0])).toBe(raw === 'ready')
  })

  it('fills missing slots as non-ready and strips readiness from missing poster IDs', () => {
    const document = sequenceDocument('running', ['ready'])
    document.posters[0] = { ...document.posters[0], poster_id: null }
    const normalized = normalizeSequenceResult(document)
    expect(normalized.posters.map((slot) => slot.status)).toEqual([
      'unknown',
      'missing',
      'missing',
    ])
    expect(normalized.completedPosterCount).toBe(0)
    expect(normalized.posters.every((slot) => !isEligibleReadySlot(slot))).toBe(
      true,
    )
  })

  it('preserves response order while clamping indexes and deriving a coherent ready count', () => {
    const document = sequenceDocument(
      'partial_failed',
      ['ready', 'ready', 'failed'],
      { completed_poster_count: 99, current_poster_index: 99 },
    )
    document.posters = [document.posters[1], document.posters[0], document.posters[2]]
    const normalized = normalizeSequenceResult(document)
    expect(normalized.posters[0].posterId).toBe(TEST_POSTER_IDS[1])
    expect(normalized.posters[1].posterId).toBe(TEST_POSTER_IDS[0])
    expect(normalized.completedPosterCount).toBe(2)
    expect(normalized.currentPosterIndex).toBe(3)
  })

  it('keeps ready posters usable for partial and interrupted results', () => {
    for (const status of ['partial_failed', 'interrupted']) {
      const normalized = normalizedSequence(status, [
        'ready',
        'failed',
        'blocked',
      ])
      expect(isEligibleReadySlot(normalized.posters[0])).toBe(true)
      expect(normalized.posters[0].previewUrl).toMatch(/^\/api\/v1\//)
      expect(normalized.zipDownloadUrl).toBeNull()
    }
  })

  it.each([
    ['https://example.com/api/v1/x', null],
    ['//example.com/api/v1/x', null],
    ['/api/v1/../secret', null],
    ['/api/v1/generations/ok', '/api/v1/generations/ok'],
  ])('guards relative API URL %s', (value, expected) => {
    expect(safeRelativeApiUrl(value)).toBe(expected)
  })

  it('removes unsafe resource URLs without rejecting the last good result', () => {
    const document = sequenceDocument('running', [
      'ready',
      'generating',
      'waiting',
    ])
    document.posters[0] = {
      ...document.posters[0],
      preview_url: 'https://evil.example/poster.png',
      download_url: '/api/v1/../secret',
    }
    const normalized = normalizeSequenceResult(document)
    expect(normalized.posters[0].status).toBe('ready')
    expect(normalized.posters[0].previewUrl).toBeNull()
    expect(normalized.posters[0].downloadUrl).toBeNull()
  })

  it('rejects malformed success roots, modes, IDs, and marketing copy', () => {
    expect(() => normalizeSequenceResult([])).toThrow()
    expect(() =>
      normalizeSequenceResult({
        ...sequenceDocument(),
        generation_mode: 'legacy_background_composite',
      }),
    ).toThrow()
    expect(() =>
      normalizeSequenceResult({
        ...sequenceDocument(),
        generation_id: 'not-a-uuid',
      }),
    ).toThrow()
    expect(() =>
      normalizeSequenceResult({
        ...sequenceDocument(),
        marketing_copy: { body: 'missing required fields' },
      }),
    ).toThrow()
  })

  it('exposes ZIP only for exactly completed with a safe relative URL', () => {
    expect(normalizedSequence('completed', ['ready', 'ready', 'ready']).zipDownloadUrl).toMatch(
      /^\/api\/v1\//,
    )
    expect(
      normalizedSequence('running', ['ready', 'ready', 'ready'], {
        zip_download_url: '/api/v1/generations/x/download',
      }).zipDownloadUrl,
    ).toBeNull()
  })
})

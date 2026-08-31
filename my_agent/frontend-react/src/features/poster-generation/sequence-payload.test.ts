import { describe, expect, it, vi } from 'vitest'
import {
  acquirePendingSequenceIntent,
  canonicalSequenceJson,
  sequenceIntentFingerprint,
} from './poster-fingerprint'
import { buildPosterSequencePayload, buildV2PosterSequencePayload } from './sequence-payload'
import type {
  ConfirmedCopy,
  PosterProjectInput,
  PresentAdviceAuthority,
} from '../../state/workflow-v2/workflow-v2-types'
import { copyRefFromConfirmedCopy } from '../../state/workflow-v2/workflow-v2-authorities'

const copy = {
  platform: 'taobao' as const,
  style: 'vibrant' as const,
  copyDraft: '手动编辑正文',
  platformCopy: {
    body: '手动编辑正文',
    title: '标题',
    headline: '主标',
    subline: '副标',
    unknown: { keep: true },
  },
  variants: [],
  selectedVariantIndex: 0,
  generationPlatform: 'taobao' as const,
  generationStyle: 'vibrant' as const,
  marketingStrategy: {},
  strategyOwner: {
    sourceKind: 'copy' as const,
    intentFingerprint: 'copy-fingerprint',
    idempotencyKey: 'copy-key',
    requestId: null,
    platform: 'taobao' as const,
    style: 'vibrant' as const,
  },
}

describe('poster sequence intent', () => {
  it('builds only the exact active sequence payload and preserves edited copy metadata', () => {
    expect(
      buildPosterSequencePayload(
        {
          productInfo: '  咖啡豆  ',
          productShortName: '',
          creativeNote: '克制高级',
        },
        copy,
      ),
    ).toEqual({
      product_info: '咖啡豆',
      product_short_name: '',
      creative_note: '克制高级',
      visual_style: 'vibrant',
      target_platform: 'taobao',
      generate_poster: true,
      generation_mode: 'seedream_product_poster_sequence',
      send_product_to_provider: true,
      requested_poster_count: 3,
      text_rendering_mode: 'local',
      output_size: '1024x1536',
      prefilled_copy_body: '手动编辑正文',
      prefilled_copy_title: '标题',
      prefilled_copy_headline: '主标',
      prefilled_copy_subline: '副标',
    })
  })

  it('sorts keys recursively and creates a stable bytes-only fingerprint', async () => {
    const payload = buildPosterSequencePayload(
      { productInfo: '咖啡', productShortName: '', creativeNote: '' },
      copy,
    )
    const canonical = canonicalSequenceJson(payload)
    expect(canonical).toBe(canonicalSequenceJson({ ...payload }))
    expect(Object.keys(JSON.parse(canonical))).toEqual(
      [...Object.keys(payload)].sort(),
    )
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const first = await sequenceIntentFingerprint(canonical, bytes)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await sequenceIntentFingerprint(canonical, bytes)).toBe(first)
    expect(
      await sequenceIntentFingerprint(
        canonical,
        new Uint8Array([1, 2, 4]).buffer,
      ),
    ).not.toBe(first)
  })

  it('reuses same-intent pending keys and replaces changed or cleared intent', () => {
    const factory = vi
      .fn<() => string>()
      .mockReturnValueOnce('key-one')
      .mockReturnValueOnce('key-two')
    const first = acquirePendingSequenceIntent(
      { pendingFingerprint: null, pendingIdempotencyKey: null },
      'fingerprint-one',
      factory,
    )
    const replay = acquirePendingSequenceIntent(
      {
        pendingFingerprint: first.fingerprint,
        pendingIdempotencyKey: first.idempotencyKey,
      },
      'fingerprint-one',
      factory,
    )
    const changed = acquirePendingSequenceIntent(
      {
        pendingFingerprint: first.fingerprint,
        pendingIdempotencyKey: first.idempotencyKey,
      },
      'fingerprint-two',
      factory,
    )
    expect(replay.idempotencyKey).toBe('key-one')
    expect(changed.idempotencyKey).toBe('key-two')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('keeps Poster-owned copy separate, freezes an explicit current CopyRef, and carries only a selected template ID', async () => {
    const advice = {
      adviceVersion: 'catalog-v1',
      inputSignatureSha256: '1'.repeat(64),
      adviceSignatureSha256: '2'.repeat(64),
    } as PresentAdviceAuthority
    const ownedProject = {
      copySource: 'poster_owned',
      platform: 'taobao',
      style: 'vibrant',
      copyRef: null,
      generationKind: 'blank_base',
      typographyMode: 'textless',
      styleTemplateId: null,
    } as PosterProjectInput
    const owned = buildV2PosterSequencePayload(
      { productInfo: 'Poster product', productShortName: 'P', creativeNote: '' },
      ownedProject,
      advice,
      null,
    )
    expect(owned.prefilled_copy_body).toBe('')
    expect(owned.v2_poster_copy_source).toEqual({ mode: 'poster_owned' })
    expect(owned.marketing_advice_ref).toEqual({
      advice_version: 'catalog-v1',
      input_signature_sha256: '1'.repeat(64),
      advice_signature_sha256: '2'.repeat(64),
    })
    expect(owned).not.toHaveProperty('style_template_id')

    const templated = buildV2PosterSequencePayload(
      { productInfo: 'Poster product', productShortName: 'P', creativeNote: '' },
      {
        ...ownedProject,
        generationKind: 'template',
        typographyMode: 'textless',
        styleTemplateId: 'paper_doodle_grid',
      } as PosterProjectInput,
      advice,
      null,
    )
    expect(templated.style_template_id).toBe('paper_doodle_grid')
    expect(templated.sequence_typography_mode).toBe('textless')
    expect(templated).not.toHaveProperty('template_alias')
    expect(templated).not.toHaveProperty('template_prompt')
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const defaultFingerprint = await sequenceIntentFingerprint(
      canonicalSequenceJson(owned),
      bytes,
    )
    const templateCanonical = canonicalSequenceJson(templated)
    const templateFingerprint = await sequenceIntentFingerprint(templateCanonical, bytes)
    expect(templateFingerprint).not.toBe(defaultFingerprint)
    expect(await sequenceIntentFingerprint(templateCanonical, bytes)).toBe(templateFingerprint)

    const confirmed = {
      authorityVersion: 'workflow-v2-confirmed-copy-v1',
      body: 'Frozen body', title: 'Frozen title', headline: 'Frozen headline', subline: 'Frozen subline',
      platform: 'taobao', style: 'vibrant', revision: 4,
      input: {
        basicOwner: { textSignatureSha256: '3'.repeat(64), settingsSignatureSha256: '4'.repeat(64) },
        adviceOwner: { kind: 'present', authorityVersion: 'workflow-v2-advice-authority-v1', adviceVersion: 'catalog-v1', inputSignatureSha256: '1'.repeat(64), adviceSignatureSha256: '2'.repeat(64), ownerSignatureSha256: '5'.repeat(64) },
        inputSignatureSha256: '6'.repeat(64),
      }, outputSignatureSha256: '7'.repeat(64),
    } as ConfirmedCopy
    const currentProject = {
      ...ownedProject,
      generationKind: 'template',
      typographyMode: 'textless',
      copySource: 'confirmed_copy',
      copyRef: copyRefFromConfirmedCopy(confirmed),
      styleTemplateId: 'paper_doodle_grid',
    } as PosterProjectInput
    const fromCopy = buildV2PosterSequencePayload(
      { productInfo: 'Poster product', productShortName: 'P', creativeNote: '' },
      currentProject,
      advice,
      confirmed,
    )
    expect(fromCopy.prefilled_copy_body).toBe('Frozen body')
    expect(fromCopy.style_template_id).toBe('paper_doodle_grid')
    expect(fromCopy.v2_poster_copy_source?.mode).toBe('confirmed_copy')
    expect(fromCopy.v2_poster_copy_source?.frozen_copy?.source_copy_ref.output_signature_sha256)
      .toBe(confirmed.outputSignatureSha256)

    expect(() => buildV2PosterSequencePayload(
      { productInfo: 'Poster product', productShortName: 'P', creativeNote: '' },
      { ...currentProject, copyRef: { ...copyRefFromConfirmedCopy(confirmed), revision: 99 } },
      advice,
      confirmed,
    )).toThrow('current Confirmed Copy')
  })
})

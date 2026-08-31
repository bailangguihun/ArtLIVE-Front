import { normalizeSequenceResult } from './poster-normalizer'
import { createInitialWorkflowState } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import type {
  NormalizedSequenceResult,
  PosterGenerationState,
} from '../../types/poster-generation'

export const TEST_GENERATION_ID = '11111111-1111-4111-8111-111111111111'
export const TEST_REQUEST_ID = '22222222-2222-4222-8222-222222222222'
export const TEST_POSTER_IDS = [
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332',
  '33333333-3333-4333-8333-333333333333',
] as const

export type FixtureSlotStatus =
  | 'waiting'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'blocked'
  | string

export function sequenceDocument(
  status: string = 'queued',
  slotStatuses: FixtureSlotStatus[] = ['waiting', 'waiting', 'waiting'],
  overrides: Record<string, unknown> = {},
) {
  const readyCount = slotStatuses.filter((item) => item === 'ready').length
  return {
    api_version: '1.0',
    request_id: TEST_REQUEST_ID,
    generation_id: TEST_GENERATION_ID,
    status,
    generation_mode: 'seedream_product_poster_sequence',
    marketing_copy: {
      body: '手动编辑后的正文',
      title: '保留标题',
      headline: '保留主标',
      subline: '保留副标',
    },
    posters: slotStatuses.map((slotStatus, index) => {
      const ready = slotStatus === 'ready'
      const posterId = ready ? TEST_POSTER_IDS[index] : null
      return {
        index: index + 1,
        concept: `concept-${index + 1}`,
        status: slotStatus,
        provider_attempt_count: slotStatus === 'waiting' ? 0 : 1,
        poster_id: posterId,
        width: ready ? 1024 : null,
        height: ready ? 1536 : null,
        preview_url: ready
          ? `/api/v1/generations/${TEST_GENERATION_ID}/posters/${posterId}`
          : null,
        download_url: ready
          ? `/api/v1/generations/${TEST_GENERATION_ID}/posters/${posterId}/download`
          : null,
        safe_error_code:
          slotStatus === 'failed' ? 'provider_timeout' : null,
      }
    }),
    zip_download_url:
      status === 'completed'
        ? `/api/v1/generations/${TEST_GENERATION_ID}/download`
        : null,
    completed_poster_count: readyCount,
    current_poster_index:
      status === 'running'
        ? Math.max(1, slotStatuses.indexOf('generating') + 1)
        : null,
    qa:
      status === 'failed' || status === 'partial_failed'
        ? { safe_error_code: 'provider_timeout' }
        : {},
    ...overrides,
  }
}

export function normalizedSequence(
  status: string = 'queued',
  slotStatuses: FixtureSlotStatus[] = ['waiting', 'waiting', 'waiting'],
  overrides: Record<string, unknown> = {},
): NormalizedSequenceResult {
  return normalizeSequenceResult(
    sequenceDocument(status, slotStatuses, overrides),
  )
}

export function createStepThreeState(
  posterOverrides: Partial<PosterGenerationState> = {},
): WorkflowState {
  const initial = createInitialWorkflowState()
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'coffee.png', {
    type: 'image/png',
  })
  const variant = {
    body: '手动编辑后的正文',
    title: '保留标题',
    headline: '保留主标',
    subline: '保留副标',
    future: { preserved: true },
  }
  const values = {
    productInfo: '低温慢烘精品咖啡豆',
    productShortName: '晨光咖啡',
    creativeNote: '突出细腻香气',
  }
  const strategyOwner = {
    sourceKind: 'copy' as const,
    intentFingerprint: 'copy-fingerprint',
    idempotencyKey: 'copy-key',
    requestId: TEST_REQUEST_ID,
    platform: 'xiaohongshu' as const,
    style: 'premium' as const,
  }
  return {
    ...initial,
    currentStep: 3,
    completedSteps: new Set([1, 2]),
    productInfo: {
      values,
      errors: {},
      productImage: {
        file,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        previewUrl: 'blob:product-image',
      },
      completedDraft: {
        ...values,
        productImage: {
          file,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          previewUrl: 'blob:product-image',
        },
      },
    },
    platformCopy: {
      ...initial.platformCopy,
      copyDraft: variant.body,
      platformCopy: variant,
      variants: [variant],
      selectedVariantIndex: 0,
      generationPlatform: 'xiaohongshu',
      generationStyle: 'premium',
      marketingStrategy: { name: '保留策略' },
      strategyOwner,
      completedDraft: {
        platform: 'xiaohongshu',
        style: 'premium',
        copyDraft: variant.body,
        platformCopy: variant,
        variants: [variant],
        selectedVariantIndex: 0,
        generationPlatform: 'xiaohongshu',
        generationStyle: 'premium',
        marketingStrategy: { name: '保留策略' },
        strategyOwner,
      },
    },
    posterGeneration: {
      ...initial.posterGeneration,
      consent: true,
      capabilities: {
        status: 'ready',
        sequenceEnabled: true,
        seedreamConfigured: true,
        error: '',
      },
      ...posterOverrides,
    },
  }
}

export function jsonResponse(document: unknown, status = 200) {
  return new Response(JSON.stringify(document), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const PNG_BYTES = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0,
])

export const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x05, 0x06])

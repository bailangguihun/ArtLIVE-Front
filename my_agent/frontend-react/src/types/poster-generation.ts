import type {
  CopyStyleId,
  CopyVariant,
  MarketingStrategy,
  PlatformId,
} from './platform-copy'
import type { PosterStyleTemplateId } from './poster-style-template'

export const POSTER_SEQUENCE_MODE =
  'seedream_product_poster_sequence' as const

export const POSTER_SLOT_TITLES = [
  '海报 1：主视觉构图',
  '海报 2：编辑特写构图',
  '海报 3：极简品牌构图',
] as const

export type KnownOverallStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial_failed'
  | 'interrupted'

export type NormalizedOverallStatus = KnownOverallStatus | 'unknown'

export type KnownPosterSlotStatus =
  | 'waiting'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'blocked'

export type NormalizedPosterSlotStatus =
  | KnownPosterSlotStatus
  | 'missing'
  | 'unknown'

export interface SequencePayload {
  product_info: string
  product_short_name: string
  creative_note: string
  visual_style: CopyStyleId
  target_platform: PlatformId
  generate_poster: true
  generation_mode: typeof POSTER_SEQUENCE_MODE
  send_product_to_provider: true
  requested_poster_count: 3
  text_rendering_mode: 'local'
  output_size: '1024x1536'
  prefilled_copy_body: string
  prefilled_copy_title: string
  prefilled_copy_headline: string
  prefilled_copy_subline: string
  style_template_id?: PosterStyleTemplateId
  /** V2 sequence typography: textless bases vs provider-rendered copy. */
  sequence_typography_mode?: 'textless' | 'with_text'
  marketing_advice_ref?: {
    advice_version: 'catalog-v1'
    input_signature_sha256: string
    advice_signature_sha256: string
  }
  v2_poster_copy_source?: {
    mode: 'confirmed_copy' | 'poster_owned'
    copy_ref?: {
      version: 'workflow-v2-copy-ref-v1'
      copy_authority_version: 'workflow-v2-confirmed-copy-v1'
      revision: number
      basic_owner: {
        text_signature_sha256: string
        settings_signature_sha256: string
      }
      advice_owner: Record<string, string | undefined>
      input_signature_sha256: string
      output_signature_sha256: string
    }
    frozen_copy?: {
      body: string
      title: string
      headline: string
      subline: string
      platform: PlatformId
      style: CopyStyleId
      source_copy_ref: Record<string, unknown>
    }
  }
}

export interface NormalizedPosterSlot {
  displayIndex: 1 | 2 | 3
  sourceIndex: number | null
  concept: string
  status: NormalizedPosterSlotStatus
  rawStatus: string
  providerAttemptCount: number
  posterId: string | null
  width: number | null
  height: number | null
  previewUrl: string | null
  downloadUrl: string | null
  safeErrorCode: string | null
}

export interface NormalizedSequenceResult {
  apiVersion: string
  requestId: string | null
  generationId: string
  status: NormalizedOverallStatus
  rawStatus: string
  generationMode: typeof POSTER_SEQUENCE_MODE
  marketingCopy: CopyVariant
  marketingStrategy: MarketingStrategy
  targetPlatform: PlatformId | null
  targetPlatformResolution: 'known' | 'legacy-defaulted-unknown' | 'missing'
  posters: NormalizedPosterSlot[]
  zipDownloadUrl: string | null
  completedPosterCount: number
  currentPosterIndex: number | null
  safeErrorCode: string | null
}

export type CapabilityLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PosterCapabilitiesState {
  status: CapabilityLoadStatus
  sequenceEnabled: boolean | null
  seedreamConfigured: boolean | null
  error: string
}

export type PendingSequencePhase =
  | 'hashing'
  | 'submitting'
  | 'accepted'
  | 'ambiguous'
  | 'rejected'
  | null

export type BinaryStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface BinaryResourceState {
  status: BinaryStatus
  blob: Blob | null
  objectUrl: string | null
  error: string
}

export interface PosterBinaryState {
  preview: BinaryResourceState
  download: BinaryResourceState
}

export interface ZipBinaryState extends BinaryResourceState {
  generationId: string | null
}

export interface PosterGenerationErrors {
  admission: string
  polling: string
}

export interface PosterGenerationCompletedDraft {
  generationId: string
  selectedIndex: number
  posterId: string
  selectedSlot: NormalizedPosterSlot
}

export interface PosterGenerationState {
  consent: boolean
  admissionBusy: boolean
  errors: PosterGenerationErrors
  capabilities: PosterCapabilitiesState
  result: NormalizedSequenceResult | null
  resultIntentFingerprint: string | null
  activeGenerationId: string | null
  pendingFingerprint: string | null
  pendingIdempotencyKey: string | null
  pendingIntentPhase: PendingSequencePhase
  selectedIndex: number | null
  selectedPosterId: string | null
  selectedSlot: NormalizedPosterSlot | null
  succeededOnce: boolean
  posterBinaries: Record<string, PosterBinaryState>
  zipBinary: ZipBinaryState
  completedDraft: PosterGenerationCompletedDraft | null
  selectionRevision: number
  resourceRevision: number
}

export interface CapturedSequenceIntent {
  payload: SequencePayload
  canonicalPayload: string
  productImageBytes: ArrayBuffer
  productImageMimeType: string
}

export function emptyBinaryResourceState(): BinaryResourceState {
  return {
    status: 'idle',
    blob: null,
    objectUrl: null,
    error: '',
  }
}

export function createInitialPosterGenerationState(): PosterGenerationState {
  return {
    consent: false,
    admissionBusy: false,
    errors: { admission: '', polling: '' },
    capabilities: {
      status: 'idle',
      sequenceEnabled: null,
      seedreamConfigured: null,
      error: '',
    },
    result: null,
    resultIntentFingerprint: null,
    activeGenerationId: null,
    pendingFingerprint: null,
    pendingIdempotencyKey: null,
    pendingIntentPhase: null,
    selectedIndex: null,
    selectedPosterId: null,
    selectedSlot: null,
    succeededOnce: false,
    posterBinaries: {},
    zipBinary: {
      ...emptyBinaryResourceState(),
      generationId: null,
    },
    completedDraft: null,
    selectionRevision: 0,
    resourceRevision: 0,
  }
}

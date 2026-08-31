import type { CopyStyleId, PlatformId } from './platform-copy'

export type PosterEditorPanel = 'text' | 'shape' | 'image'
export type PosterTextRole = 'title' | 'headline' | 'subline' | `custom-${number}`
export type PosterTextAlign = 'left' | 'center'
export type PosterShapeType = 'rect' | 'ellipse' | 'line' | 'star' | 'diamond'

export interface PosterTextBox {
  id: string
  role: PosterTextRole
  text: string
  fontId: string | null
  fontSize: number
  color: string
  align: PosterTextAlign
  strokeEnabled: boolean
  strokeWidth: number
  strokeColor: string
  showBox: boolean
  x: number
  y: number
}

export interface PosterShape {
  id: string
  type: PosterShapeType
  x: number
  y: number
  w: number
  h: number
  rotation: 0
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
  strokeOpacity: number
}

export interface PosterImage {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  blobId: string
  sha256: string
}

export interface CompletePosterLayout {
  fontId: string
  textBoxes: PosterTextBox[]
  shapes: PosterShape[]
  images: PosterImage[]
}

export type PosterBlobResourceKind = 'base' | 'overlay'

export interface PosterBlobResource {
  id: string
  kind: PosterBlobResourceKind
  blob: Blob
  sha256: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  name: string
  width: number
  height: number
}

export interface PosterCopySnapshot {
  body: string
  title: string
  headline: string
  subline: string
  platform: PlatformId
  style: CopyStyleId
}

export interface PosterDraft {
  generationId: string
  /** V2 uses project + selected base identity; legacy drafts use generationId. */
  draftKey: string
  layout: CompletePosterLayout
  nextCustomIndex: number
}

export interface ActivePosterEditor {
  generationId: string
  posterId: string
  slot: number
  downloadUrl: string
  baseBlobId: string
  baseBlobSha256: string
  intrinsicWidth: number
  intrinsicHeight: number
  upstreamSha256: string
  copySnapshot: PosterCopySnapshot
  resourceRevision: number
  draftKey?: string
  posterProjectInputSignatureSha256?: string | null
  posterCopySource?: 'confirmed_copy' | 'poster_owned' | null
}

export interface ConfirmedPoster {
  generationId: string
  posterId: string
  slot: number
  baseBlobSha256: string
  layoutSha256: string
  upstreamSha256: string
  inputSignatureSha256: string
  copySnapshot: PosterCopySnapshot
  layout: CompletePosterLayout
  pngBlob: Blob
  pngBlobSha256: string
  confirmedRevision: number
}

export interface Step4Completion {
  generationId: string
  posterId: string
  confirmedRevision: number
  baseBlobSha256: string
  layoutSha256: string
  upstreamSha256: string
  pngBlobSha256: string
}

export interface PosterEditorOperationState {
  entryBusy: boolean
  exportBusy: boolean
  confirmationBusy: boolean
  entryError: string
  exportError: string
  confirmationError: string
  imageStatus: string
}

export interface PosterEditorState {
  drafts: Record<string, PosterDraft>
  active: ActivePosterEditor | null
  activePanel: PosterEditorPanel
  selectedTextId: string | null
  selectedShapeId: string | null
  selectedImageId: string | null
  compositionRevision: number
  resourceRevision: number
  resources: Record<string, PosterBlobResource>
  currentLayoutSha256: string | null
  confirmedPoster: ConfirmedPoster | null
  completion: Step4Completion | null
  rendererMismatchCount: number
  operations: PosterEditorOperationState
}

export function createInitialPosterEditorState(): PosterEditorState {
  return {
    drafts: {},
    active: null,
    activePanel: 'text',
    selectedTextId: 'box-title',
    selectedShapeId: null,
    selectedImageId: null,
    compositionRevision: 0,
    resourceRevision: 0,
    resources: {},
    currentLayoutSha256: null,
    confirmedPoster: null,
    completion: null,
    rendererMismatchCount: 0,
    operations: {
      entryBusy: false,
      exportBusy: false,
      confirmationBusy: false,
      entryError: '',
      exportError: '',
      confirmationError: '',
      imageStatus: '',
    },
  }
}

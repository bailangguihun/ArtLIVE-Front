export type DetailEditorPanel = 'background' | 'text' | 'shape' | 'image'
export type DetailShapeKind = 'line' | 'rect' | 'ellipse' | 'star' | 'diamond'
export type DetailResourceKind = 'poster-final' | 'upload' | 'cutout' | 'near-white' | 'custom-background'

export interface DetailOwnerIdentity {
  generationId: string
  posterId: string
  inputSignatureSha256: string
  pngBlobSha256: string
}

export interface DetailSystemBackground {
  kind: 'system'
  catalogId: string
  resourceId: string
  sha256: string
}

export interface DetailCustomBackground {
  kind: 'custom'
  resourceId: string
  sha256: string
  fallbackCatalogId: string
  fallbackSha256: string
}

export type DetailBackground = DetailSystemBackground | DetailCustomBackground

interface DetailTransform {
  left: number
  top: number
  angle: number
  scaleX: number
  scaleY: number
  originX: 'center'
  originY: 'center'
}

export interface DetailTextLayer extends DetailTransform {
  id: string
  kind: 'text'
  text: string
  fontId: string
  fontSize: number
  fill: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  strokeEnabled: boolean
  stroke: string
  strokeWidth: number
}

export interface DetailLineGeometry {
  points: readonly [-120, 0, 120, 0]
}

export interface DetailRectGeometry {
  width: number
  height: number
}

export interface DetailEllipseGeometry {
  rx: number
  ry: number
}

export interface DetailStarGeometry {
  outerRadius: number
  innerRadius: number
  spikes: number
}

export type DetailShapeGeometry =
  | DetailLineGeometry
  | DetailRectGeometry
  | DetailEllipseGeometry
  | DetailStarGeometry

export interface DetailShapeLayer extends DetailTransform {
  id: string
  kind: 'shape'
  shapeKind: DetailShapeKind
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  geometry: DetailShapeGeometry
}

export interface DetailImageLayer extends DetailTransform {
  id: string
  kind: 'image'
  resourceId: string
}

export type DetailLayer = DetailTextLayer | DetailShapeLayer | DetailImageLayer

export interface DetailPageExport {
  pageId: string
  revision: number
  signatureSha256: string
  pngBlob: Blob
  pngBlobSha256: string
  width: 750
  height: 1334
}

export interface DetailPage {
  id: string
  background: DetailBackground
  activeProductId: string | null
  selectedFontId: string
  layers: DetailLayer[]
  compositionRevision: number
  currentExport: DetailPageExport | null
}

export interface DetailResource {
  id: string
  kind: DetailResourceKind
  name: string
  blob: Blob
  sha256: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
}

export interface ConfirmedDetails {
  owner: DetailOwnerIdentity
  pageExports: DetailPageExport[]
  pngBlobs: Blob[]
  firstPngBlob: Blob
  groupSignatureSha256: string
  confirmedResourceRevision: number
}

export interface Step5Completion {
  owner: DetailOwnerIdentity
  groupSignatureSha256: string
  pageCount: number
  pngBlobSha256: string[]
}

export interface DetailEditorOperations {
  exportBusy: boolean
  confirmationBusy: boolean
  imageBusy: boolean
  exportError: string
  confirmationError: string
  imageStatus: string
}

export interface DetailEditorState {
  owner: DetailOwnerIdentity | null
  pages: DetailPage[]
  activePageIndex: number
  resources: Record<string, DetailResource>
  resourceRevision: number
  activePanel: DetailEditorPanel
  selectedLayerId: string | null
  selectedResourceId: string | null
  nextPageSequence: number
  nextLayerSequence: number
  confirmedDetails: ConfirmedDetails | null
  completion: Step5Completion | null
  rendererMismatchCount: number
  operations: DetailEditorOperations
}

export function createInitialDetailEditorState(): DetailEditorState {
  return {
    owner: null,
    pages: [],
    activePageIndex: 0,
    resources: {},
    resourceRevision: 0,
    activePanel: 'text',
    selectedLayerId: null,
    selectedResourceId: null,
    nextPageSequence: 1,
    nextLayerSequence: 1,
    confirmedDetails: null,
    completion: null,
    rendererMismatchCount: 0,
    operations: {
      exportBusy: false,
      confirmationBusy: false,
      imageBusy: false,
      exportError: '',
      confirmationError: '',
      imageStatus: '',
    },
  }
}

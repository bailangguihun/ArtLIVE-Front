export const FINAL_RESULTS_PNG_MIME = 'image/png' as const

export interface FinalCopyOwner {
  generationId: string
  posterId: string
  confirmedRevision: number
  inputSignatureSha256: string
  upstreamSha256: string
  bodySignatureSha256: string
  step6SourceKind: 'copy' | 'poster' | 'none' | 'unbound'
  step6SourceOwnerSignatureSha256: string
}

export interface FinalCopyResult {
  body: string
  displayBody: string
  empty: boolean
  owner: FinalCopyOwner
}

export interface FinalGalleryAsset {
  kind: 'poster' | 'detail'
  ordinal: number
  title: string
  fileName: string
  mimeType: typeof FINAL_RESULTS_PNG_MIME
  width: number
  height: number
  blob: Blob
  sha256: string
  sourceSignatureSha256: string
}

export interface FinalResultsAuthoritySignatures {
  step4InputSignatureSha256: string
  step4LayoutSha256: string
  step4PngBlobSha256: string
  step5GroupSignatureSha256: string
  step6SignatureSha256: string
  step7SignatureSha256: string
}

export interface FinalResultsViewModel {
  finalCopy: FinalCopyResult
  poster: FinalGalleryAsset
  details: FinalGalleryAsset[]
  gallery: FinalGalleryAsset[]
  detailResourceRevision: number
  signatures: FinalResultsAuthoritySignatures
}

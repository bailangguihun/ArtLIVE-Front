export const CREATION_HISTORY_LIMIT = 30

export interface CreationHistoryCopy {
  readonly body: string
  readonly title: string
  readonly headline: string
  readonly subline: string
  readonly platform: string
  readonly style: string
  readonly outputSignatureSha256: string
}

export interface CreationHistoryImage {
  readonly kind: 'poster' | 'detail'
  readonly title: string
  readonly fileName: string
  readonly ordinal: number
  readonly width: number
  readonly height: number
  readonly sha256: string
  readonly blob: Blob
}

export interface CreationHistoryBatch {
  readonly id: string
  readonly epoch: number
  readonly updatedAt: number
  readonly productShortName: string
  readonly productInfo: string
  readonly platform: string
  readonly style: string
  readonly strategyName: string | null
  readonly copy: CreationHistoryCopy | null
  readonly poster: CreationHistoryImage | null
  readonly details: readonly CreationHistoryImage[]
}

export interface CreationHistoryListItem {
  readonly id: string
  readonly epoch: number
  readonly updatedAt: number
  readonly productShortName: string
  readonly productInfo: string
  readonly platform: string
  readonly style: string
  readonly hasCopy: boolean
  readonly hasPoster: boolean
  readonly detailCount: number
  readonly thumbnail: CreationHistoryImage | null
}

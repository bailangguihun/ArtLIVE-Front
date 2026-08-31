export const PRODUCT_INFO_LIMITS = {
  productInfo: 2000,
  productShortName: 80,
  creativeNote: 500,
} as const

export const PRODUCT_IMAGE_ACCEPT =
  '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'

export const PRODUCT_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const

export const PRODUCT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export type ProductInfoField = keyof typeof PRODUCT_INFO_LIMITS

export interface ProductInfoValues {
  productInfo: string
  productShortName: string
  creativeNote: string
}

export interface ProductImageSelection {
  file: File
  name: string
  mimeType: string
  size: number
  previewUrl: string
}

export interface ProductInfoDraft extends ProductInfoValues {
  productImage: ProductImageSelection | null
}

export interface ProductInfoErrors {
  productInfo?: string
}

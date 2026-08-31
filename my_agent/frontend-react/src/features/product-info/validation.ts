import type {
  ProductImageSelection,
  ProductInfoErrors,
  ProductInfoValues,
} from '../../types/product-info'
import {
  PRODUCT_IMAGE_EXTENSIONS,
  PRODUCT_IMAGE_MIME_TYPES,
} from '../../types/product-info'

export const PRODUCT_INFO_REQUIRED_MESSAGE = '请先填写产品信息。'
export const PRODUCT_IMAGE_TYPE_MESSAGE =
  '仅支持 PNG、JPG、JPEG 或 WebP 图片。'

export function validateProductInfo(
  values: ProductInfoValues,
): ProductInfoErrors {
  if (!values.productInfo.trim()) {
    return { productInfo: PRODUCT_INFO_REQUIRED_MESSAGE }
  }

  return {}
}

export function canContinueFromProductInfo(values: ProductInfoValues) {
  return Object.keys(validateProductInfo(values)).length === 0
}

export function isAcceptedProductImage(file: File) {
  const normalizedType = file.type.toLowerCase()
  const normalizedName = file.name.toLowerCase()
  const hasAcceptedType = PRODUCT_IMAGE_MIME_TYPES.some(
    (mimeType) => mimeType === normalizedType,
  )
  const hasAcceptedExtension = PRODUCT_IMAGE_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension),
  )

  return hasAcceptedType || hasAcceptedExtension
}

export function toProductImageSelection(
  file: File,
  previewUrl: string,
): ProductImageSelection {
  return {
    file,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    previewUrl,
  }
}

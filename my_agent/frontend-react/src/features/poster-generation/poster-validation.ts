interface PosterSubmissionValues {
  busy: boolean
  copyBody: string
  sequenceEnabled: boolean | null
  productInfo: string
  productImagePresent: boolean
  consent: boolean
}

export const POSTER_BUSY_MESSAGE = '生成请求正在处理中。'
export const POSTER_COPY_REQUIRED_MESSAGE = '请先在上一步生成平台文案。'
export const POSTER_SEQUENCE_DISABLED_SUBMIT_MESSAGE =
  'Seedream 完整海报组图当前未启用。'
export const POSTER_PRODUCT_INFO_REQUIRED_MESSAGE = '请填写产品信息。'
export const POSTER_PRODUCT_IMAGE_REQUIRED_MESSAGE = '请上传商品参考图。'
export const POSTER_CONSENT_REQUIRED_MESSAGE =
  '请先确认并同意商品参考图发送授权。'

export function getPosterSubmissionValidationError({
  busy,
  consent,
  copyBody,
  productImagePresent,
  productInfo,
  sequenceEnabled,
}: PosterSubmissionValues): string | null {
  if (busy) {
    return POSTER_BUSY_MESSAGE
  }
  if (!copyBody.trim()) {
    return POSTER_COPY_REQUIRED_MESSAGE
  }
  if (sequenceEnabled === false) {
    return POSTER_SEQUENCE_DISABLED_SUBMIT_MESSAGE
  }
  if (!productInfo.trim()) {
    return POSTER_PRODUCT_INFO_REQUIRED_MESSAGE
  }
  if (!productImagePresent) {
    return POSTER_PRODUCT_IMAGE_REQUIRED_MESSAGE
  }
  if (!consent) {
    return POSTER_CONSENT_REQUIRED_MESSAGE
  }
  return null
}

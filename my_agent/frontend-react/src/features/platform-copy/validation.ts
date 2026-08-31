import type { PlatformCopyState } from '../../types/platform-copy'

export const COPY_DRAFT_REQUIRED_MESSAGE =
  '请先生成文案，并在下方编辑框确认最终文案。'
export const COPY_VARIANTS_REQUIRED_MESSAGE = '请先点击「确认生成」。'
export const COPY_PLATFORM_MISMATCH_MESSAGE = '平台已切换，请重新生成文案。'
export const COPY_STYLE_MISMATCH_MESSAGE = '文案风格已切换，请重新生成文案。'
export const PRODUCT_INFO_MISSING_FOR_COPY_MESSAGE =
  '请先返回上一步填写产品信息。'

export function getPlatformCopyValidationError(
  state: PlatformCopyState,
): string | null {
  if (!state.copyDraft.trim()) {
    return COPY_DRAFT_REQUIRED_MESSAGE
  }

  if (state.variants.length === 0) {
    return COPY_VARIANTS_REQUIRED_MESSAGE
  }

  if (state.platform !== state.generationPlatform) {
    return COPY_PLATFORM_MISMATCH_MESSAGE
  }

  if (state.style !== state.generationStyle) {
    return COPY_STYLE_MISMATCH_MESSAGE
  }

  return null
}

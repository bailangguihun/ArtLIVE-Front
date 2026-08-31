import { describe, expect, it } from 'vitest'
import { createInitialWorkflowState } from '../../state/workflow-reducer'
import {
  COPY_DRAFT_REQUIRED_MESSAGE,
  COPY_PLATFORM_MISMATCH_MESSAGE,
  COPY_STYLE_MISMATCH_MESSAGE,
  COPY_VARIANTS_REQUIRED_MESSAGE,
  getPlatformCopyValidationError,
} from './validation'

describe('getPlatformCopyValidationError', () => {
  it('returns only the first applicable error in contract order', () => {
    const initial = createInitialWorkflowState().platformCopy
    expect(getPlatformCopyValidationError(initial)).toBe(
      COPY_DRAFT_REQUIRED_MESSAGE,
    )

    const withDraft = { ...initial, copyDraft: '已编辑文案' }
    expect(getPlatformCopyValidationError(withDraft)).toBe(
      COPY_VARIANTS_REQUIRED_MESSAGE,
    )

    const withVariants = {
      ...withDraft,
      variants: [{ body: '已编辑文案' }],
      selectedVariantIndex: 0,
    }
    expect(getPlatformCopyValidationError(withVariants)).toBe(
      COPY_PLATFORM_MISMATCH_MESSAGE,
    )

    const withPlatformMarker = {
      ...withVariants,
      generationPlatform: 'xiaohongshu' as const,
    }
    expect(getPlatformCopyValidationError(withPlatformMarker)).toBe(
      COPY_STYLE_MISMATCH_MESSAGE,
    )

    expect(
      getPlatformCopyValidationError({
        ...withPlatformMarker,
        generationStyle: 'premium',
      }),
    ).toBeNull()
  })
})

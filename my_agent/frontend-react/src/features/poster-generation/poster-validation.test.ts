import { describe, expect, it } from 'vitest'
import {
  getPosterSubmissionValidationError,
  POSTER_BUSY_MESSAGE,
  POSTER_CONSENT_REQUIRED_MESSAGE,
  POSTER_COPY_REQUIRED_MESSAGE,
  POSTER_PRODUCT_IMAGE_REQUIRED_MESSAGE,
  POSTER_PRODUCT_INFO_REQUIRED_MESSAGE,
  POSTER_SEQUENCE_DISABLED_SUBMIT_MESSAGE,
} from './poster-validation'

const valid = {
  busy: false,
  copyBody: '有效文案',
  sequenceEnabled: true,
  productInfo: '有效产品',
  productImagePresent: true,
  consent: true,
}

describe('poster submission validation', () => {
  it.each([
    [{ ...valid, busy: true }, POSTER_BUSY_MESSAGE],
    [
      {
        ...valid,
        busy: true,
        copyBody: '',
        sequenceEnabled: false,
        productInfo: '',
        productImagePresent: false,
        consent: false,
      },
      POSTER_BUSY_MESSAGE,
    ],
    [{ ...valid, copyBody: '   ' }, POSTER_COPY_REQUIRED_MESSAGE],
    [
      { ...valid, copyBody: '', sequenceEnabled: false },
      POSTER_COPY_REQUIRED_MESSAGE,
    ],
    [
      { ...valid, sequenceEnabled: false },
      POSTER_SEQUENCE_DISABLED_SUBMIT_MESSAGE,
    ],
    [{ ...valid, productInfo: '  ' }, POSTER_PRODUCT_INFO_REQUIRED_MESSAGE],
    [
      { ...valid, productImagePresent: false },
      POSTER_PRODUCT_IMAGE_REQUIRED_MESSAGE,
    ],
    [{ ...valid, consent: false }, POSTER_CONSENT_REQUIRED_MESSAGE],
  ])('returns the first contract error in exact order', (values, expected) => {
    expect(getPosterSubmissionValidationError(values)).toBe(expected)
  })

  it('does not reject an unknown capability state or unconfigured provider flag', () => {
    expect(
      getPosterSubmissionValidationError({
        ...valid,
        sequenceEnabled: null,
      }),
    ).toBeNull()
  })
})

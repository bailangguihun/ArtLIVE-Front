import { describe, expect, it } from 'vitest'
import { createBasicAuthority } from './workflow-v2-authorities'
import { sha256Blob } from '../../features/poster-editor/poster-signature'

describe('Round 3 Basic byte identity', () => {
  it('uses bytes rather than filename or metadata as the product-image owner', async () => {
    const metadata = { mimeType: 'image/png', byteSize: 3 }
    const firstBytes = new Blob([new Uint8Array([1, 2, 3])], { type: metadata.mimeType })
    const secondBytes = new Blob([new Uint8Array([1, 2, 4])], { type: metadata.mimeType })
    const first = await createBasicAuthority({
      productInfo: '商品', productShortName: '', creativeNote: '', platform: 'xiaohongshu', style: 'premium',
      productImage: { ...metadata, byteSha256: await sha256Blob(firstBytes) },
    })
    const second = await createBasicAuthority({
      productInfo: '商品', productShortName: '', creativeNote: '', platform: 'xiaohongshu', style: 'premium',
      productImage: { ...metadata, byteSha256: await sha256Blob(secondBytes) },
    })
    expect(first.productImage.kind).toBe('present')
    expect(second.productImage.kind).toBe('present')
    if (first.productImage.kind === 'present' && second.productImage.kind === 'present') {
      expect(first.productImage.byteSha256).not.toBe(second.productImage.byteSha256)
      expect(first.productImage.signatureSha256).not.toBe(second.productImage.signatureSha256)
    }
  })
})

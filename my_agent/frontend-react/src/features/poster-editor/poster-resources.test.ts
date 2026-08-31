import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canvasToPngBlob,
  decodeRasterBlob,
  POSTER_EXPORT_ERROR_MESSAGE,
  POSTER_IMAGE_DECODE_MESSAGE,
  triggerPngDownload,
  validateRasterUpload,
} from './poster-resources'

describe('Step 4 raster and disposable URL lifecycle', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:owned') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('verifies positive decoded dimensions and exposes one balanced ImageBitmap closer', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 80, height: 40, close })))
    const decoded = await decodeRasterBlob(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    expect(decoded).toMatchObject({ width: 80, height: 40 })
    decoded.close()
    expect(close).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects invalid and zero-dimension images with the safe exact error', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 0, height: 10, close })))
    await expect(decodeRasterBlob(new Blob([new Uint8Array([1])]))).rejects.toThrow(POSTER_IMAGE_DECODE_MESSAGE)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('validates upload bytes before returning a resource candidate', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 32, close })))
    const result = await validateRasterUpload(new File([new Uint8Array([1, 2, 3])], 'logo.webp', { type: 'image/webp' }))
    expect(result).toMatchObject({ width: 64, height: 32, mimeType: 'image/webp' })
    expect(result.blob.type).toBe('image/webp')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('fails a null browser PNG Blob', async () => {
    const canvas = { toBlob: (callback: BlobCallback) => callback(null) } as HTMLCanvasElement
    await expect(canvasToPngBlob(canvas)).rejects.toThrow(POSTER_EXPORT_ERROR_MESSAGE)
  })

  it('creates and revokes exactly one draft download URL with exact filename/MIME', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    triggerPngDownload(blob, 'poster-composed-2.png')
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('poster-composed-2.png')
    expect(blob.type).toBe('image/png')
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned')
  })
})

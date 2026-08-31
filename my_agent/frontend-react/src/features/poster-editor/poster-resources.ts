export const POSTER_IMAGE_ACCEPT =
  '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
export const POSTER_IMAGE_TYPE_MESSAGE = '仅支持 PNG、JPG、JPEG 或 WebP 图片。'
export const POSTER_IMAGE_DECODE_MESSAGE = '图片无法解码，请重新选择。'
export const POSTER_BASE_DECODE_MESSAGE = '所选底图不可用，请返回步骤 3 重新选用。'
export const POSTER_EXPORT_ERROR_MESSAGE = '无法生成 PNG，请重试。'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export interface DecodedRaster {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

export function acceptedRasterFile(file: File) {
  const name = file.name.toLowerCase()
  const extension = Object.keys(MIME_BY_EXTENSION).find((candidate) =>
    name.endsWith(candidate),
  )
  return Boolean(
    extension &&
      MIME_BY_EXTENSION[extension] === file.type.toLowerCase(),
  )
}

export async function decodeRasterBlob(
  blob: Blob,
  failureMessage = POSTER_IMAGE_DECODE_MESSAGE,
): Promise<DecodedRaster> {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(blob)
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        bitmap.close()
        throw new Error(failureMessage)
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      throw new Error(failureMessage)
    }
  }

  if (typeof Image === 'undefined') {
    throw new Error(failureMessage)
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    if (typeof image.decode === 'function') {
      await image.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error(failureMessage))
      })
    }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error(failureMessage)
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => undefined,
    }
  } catch {
    throw new Error(failureMessage)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function validateRasterUpload(file: File) {
  if (!acceptedRasterFile(file)) {
    throw new Error(POSTER_IMAGE_TYPE_MESSAGE)
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0) {
    throw new Error(POSTER_IMAGE_DECODE_MESSAGE)
  }
  const blob = new Blob([bytes], { type: file.type.toLowerCase() })
  const decoded = await decodeRasterBlob(blob)
  decoded.close()
  return {
    blob,
    width: decoded.width,
    height: decoded.height,
    mimeType: file.type.toLowerCase() as 'image/png' | 'image/jpeg' | 'image/webp',
  }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== 'image/png') {
        reject(new Error(POSTER_EXPORT_ERROR_MESSAGE))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}

export function triggerPngDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

import { canvasToPngBlob, decodeRasterBlob } from '../poster-editor/poster-resources'

export interface DetailAlphaBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function removeDetailNearWhitePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): DetailAlphaBounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const minimum = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      const alpha = pixels[offset + 3]
      if (minimum >= 248) pixels[offset + 3] = 0
      else if (minimum >= 225) pixels[offset + 3] = Math.floor(alpha * (248 - minimum) / 23)
      if (pixels[offset + 3] > 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return maxX >= minX && maxY >= minY
    ? { left: minX, top: minY, right: maxX, bottom: maxY }
    : null
}

export async function removeDetailNearWhiteBackground(blob: Blob) {
  const decoded = await decodeRasterBlob(blob, '上传内容不是有效图片。')
  try {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = decoded.width
    sourceCanvas.height = decoded.height
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) throw new Error('canvas unavailable')
    sourceContext.drawImage(decoded.source, 0, 0)
    const pixels = sourceContext.getImageData(0, 0, decoded.width, decoded.height)
    const bounds = removeDetailNearWhitePixels(pixels.data, decoded.width, decoded.height)
    sourceContext.putImageData(pixels, 0, 0)
    if (!bounds) return canvasToPngBlob(sourceCanvas)
    const width = bounds.right - bounds.left + 1
    const height = bounds.bottom - bounds.top + 1
    if (width === decoded.width && height === decoded.height) return canvasToPngBlob(sourceCanvas)
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const outputContext = output.getContext('2d')
    if (!outputContext) throw new Error('canvas unavailable')
    outputContext.drawImage(sourceCanvas, bounds.left, bounds.top, width, height, 0, 0, width, height)
    return canvasToPngBlob(output)
  } finally {
    decoded.close()
  }
}

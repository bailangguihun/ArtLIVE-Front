import { canvasToPngBlob, decodeRasterBlob } from './poster-resources'

export interface PixelBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function removeNearWhitePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PixelBounds | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const originalAlpha = pixels[index + 3]
    const minimum = Math.min(red, green, blue)
    let alpha = originalAlpha
    if (minimum >= 248) {
      alpha = 0
    } else if (minimum >= 225) {
      alpha = Math.trunc((originalAlpha * (248 - minimum)) / 23)
    }
    pixels[index + 3] = alpha

    // Pillow RGBA getbbox considers the complete pixel tuple. RGB is retained.
    if (red !== 0 || green !== 0 || blue !== 0 || alpha !== 0) {
      const pixel = index / 4
      const x = pixel % width
      const y = Math.floor(pixel / width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null
}

export async function removeNearWhiteBackground(blob: Blob) {
  const decoded = await decodeRasterBlob(blob)
  try {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = decoded.width
    sourceCanvas.height = decoded.height
    const sourceContext = sourceCanvas.getContext('2d', {
      willReadFrequently: true,
    })
    if (!sourceContext) throw new Error('canvas unavailable')
    sourceContext.drawImage(decoded.source, 0, 0, decoded.width, decoded.height)
    const imageData = sourceContext.getImageData(
      0,
      0,
      decoded.width,
      decoded.height,
    )

    const bounds = removeNearWhitePixels(
      imageData.data,
      decoded.width,
      decoded.height,
    )
    sourceContext.putImageData(imageData, 0, 0)

    const output = document.createElement('canvas')
    output.width = bounds ? bounds.right - bounds.left + 1 : decoded.width
    output.height = bounds ? bounds.bottom - bounds.top + 1 : decoded.height
    const outputContext = output.getContext('2d')
    if (!outputContext) throw new Error('canvas unavailable')
    if (bounds) {
      outputContext.drawImage(
        sourceCanvas,
        bounds.left,
        bounds.top,
        output.width,
        output.height,
        0,
        0,
        output.width,
        output.height,
      )
    } else {
      outputContext.putImageData(imageData, 0, 0)
    }
    return await canvasToPngBlob(output)
  } finally {
    decoded.close()
  }
}

import type { CopyStyleId, CopyVariant, PlatformId } from '../../types/platform-copy'
import type { ProductImageSelection, ProductInfoValues } from '../../types/product-info'
import type {
  CompletePosterLayout,
  PosterImage,
  PosterShape,
  PosterShapeType,
  PosterTextBox,
  PosterTextRole,
} from '../../types/poster-editor'
import { resolveAvailableFontId } from './poster-fonts'

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const SHAPE_TYPES = new Set<PosterShapeType>([
  'rect',
  'ellipse',
  'line',
  'star',
  'diamond',
])

function finite(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? (Object.is(number, -0) ? 0 : number) : fallback
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)))
}

function integer(value: unknown, minimum: number, maximum: number, fallback: number) {
  return Math.min(
    maximum,
    Math.max(minimum, Math.trunc(finite(value, fallback))),
  )
}

function color(value: unknown, fallback: string) {
  const normalized = String(value || fallback)
  return HEX_COLOR.test(normalized) ? normalized.toUpperCase() : fallback
}

function textRole(value: unknown, index: number): PosterTextRole {
  const role = String(value || '')
  if (role === 'title' || role === 'headline' || role === 'subline') {
    return role
  }
  const match = /^custom-(\d+)$/.exec(role)
  return match ? (`custom-${Number(match[1])}` as const) : (`custom-${index + 1}` as const)
}

export function normalizeTextBox(box: PosterTextBox, index: number): PosterTextBox {
  return {
    id: String(box.id || `box-${index + 1}`),
    role: textRole(box.role, index),
    text: String(box.text || '').slice(0, 60),
    fontId: box.fontId ? resolveAvailableFontId(box.fontId) : null,
    fontSize: integer(box.fontSize, 12, 160, 40),
    color: color(box.color, '#FFFFFF'),
    align: box.align === 'left' ? 'left' : 'center',
    strokeEnabled: Boolean(box.strokeEnabled),
    strokeWidth: integer(box.strokeWidth, 1, 24, 2),
    strokeColor: color(box.strokeColor, '#000000'),
    showBox: Boolean(box.showBox),
    x: clamp(box.x, 0, 1, 0.5),
    y: clamp(box.y, 0, 1, 0.1),
  }
}

export function normalizeShape(shape: PosterShape, index: number): PosterShape {
  const type = SHAPE_TYPES.has(shape.type) ? shape.type : 'rect'
  const fallback = type === 'line'
    ? { x: 0.25, y: 0.5, w: 0.5, h: 0, strokeWidth: 4 }
    : { x: 0.3, y: 0.4, w: 0.4, h: 0.18, strokeWidth: 3 }
  let x = clamp(shape.x, 0, 1, fallback.x)
  let y = clamp(shape.y, 0, 1, fallback.y)
  let w = finite(shape.w, fallback.w)
  let h = finite(shape.h, fallback.h)
  if (type === 'line') {
    const x2 = clamp(x + w, 0, 1, x)
    const y2 = clamp(y + h, 0, 1, y)
    w = x2 - x
    h = y2 - y
  } else {
    w = Math.max(0.01, Math.min(1, Math.abs(w)))
    h = Math.max(0.01, Math.min(1, Math.abs(h)))
    if (x + w > 1) x = Math.max(0, 1 - w)
    if (y + h > 1) y = Math.max(0, 1 - h)
  }
  return {
    id: String(shape.id || `shape-${index + 1}`),
    type,
    x,
    y,
    w,
    h,
    rotation: 0,
    fill: color(shape.fill, '#FFFFFF'),
    fillOpacity: type === 'line' ? 0 : clamp(shape.fillOpacity, 0, 1, 0.35),
    stroke: color(shape.stroke, '#111111'),
    strokeWidth: integer(shape.strokeWidth, 1, 64, fallback.strokeWidth),
    strokeOpacity: clamp(shape.strokeOpacity, 0, 1, 1),
  }
}

export function normalizePosterImage(image: PosterImage, index: number): PosterImage {
  let x = clamp(image.x, 0, 1, 0.1)
  let y = clamp(image.y, 0, 1, 0.1)
  const w = Math.max(0.04, Math.min(1, Math.abs(finite(image.w, 0.2))))
  const h = Math.max(0.04, Math.min(1, Math.abs(finite(image.h, 0.15))))
  if (x + w > 1) x = Math.max(0, 1 - w)
  if (y + h > 1) y = Math.max(0, 1 - h)
  return {
    id: String(image.id || `img-${index + 1}`),
    name: String(image.name || `图片 ${index + 1}`),
    x,
    y,
    w,
    h,
    blobId: String(image.blobId || ''),
    sha256: String(image.sha256 || ''),
  }
}

export function normalizeCompletePosterLayout(
  layout: CompletePosterLayout,
): CompletePosterLayout {
  return {
    fontId: resolveAvailableFontId(layout.fontId),
    textBoxes: Array.isArray(layout.textBoxes)
      ? layout.textBoxes.map(normalizeTextBox)
      : [],
    shapes: Array.isArray(layout.shapes) ? layout.shapes.map(normalizeShape) : [],
    images: Array.isArray(layout.images)
      ? layout.images.map(normalizePosterImage).filter((item) => item.blobId && item.sha256)
      : [],
  }
}

export function canonicalValue(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Object.is(value, -0) ? 0 : value
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && typeof item !== 'function')
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalValue(item)]),
    )
  }
  return null
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value))
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export async function sha256Bytes(bytes: BufferSource) {
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', bytes))
}

export async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value))
}

export async function sha256Blob(blob: Blob) {
  return sha256Bytes(await blob.arrayBuffer())
}

export async function layoutSha256(layout: CompletePosterLayout) {
  return sha256Text(canonicalJson(normalizeCompletePosterLayout(layout)))
}

interface UpstreamFingerprintInput {
  generationId: string
  product: ProductInfoValues
  productImage: ProductImageSelection | null
  platform: PlatformId
  style: CopyStyleId
  selectedVariantIndex: number | null
  selectedVariant: CopyVariant | null
  finalBody: string
}

export async function upstreamSha256(input: UpstreamFingerprintInput) {
  const productImageSha256 = input.productImage
    ? await sha256Blob(input.productImage.file)
    : null
  return sha256Text(
    canonicalJson({
      generationId: input.generationId,
      product: input.product,
      productImage: input.productImage
        ? {
            sha256: productImageSha256,
            mimeType: input.productImage.mimeType,
            size: input.productImage.size,
          }
        : null,
      platform: input.platform,
      style: input.style,
      selectedVariantIndex: input.selectedVariantIndex,
      selectedVariant: input.selectedVariant,
      finalBody: input.finalBody,
    }),
  )
}

export async function completeInputSignatureSha256(input: {
  generationId: string
  posterId: string
  slot: number
  baseBlobSha256: string
  layoutSha256: string
  upstreamSha256: string
  overlayBlobSha256: string[]
}) {
  return sha256Text(canonicalJson(input))
}

export function sameNormalizedLayout(
  left: CompletePosterLayout,
  right: CompletePosterLayout,
) {
  return canonicalJson(normalizeCompletePosterLayout(left)) ===
    canonicalJson(normalizeCompletePosterLayout(right))
}

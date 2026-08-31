import type { ConfirmedPoster } from '../../types/poster-editor'
import type { DetailOwnerIdentity, DetailResource, DetailResourceKind } from '../../types/detail-editor'
import { decodeRasterBlob } from '../poster-editor/poster-resources'
import { sha256Blob } from '../poster-editor/poster-signature'
import {
  DETAIL_CANVAS_HEIGHT,
  DETAIL_CANVAS_WIDTH,
  DETAIL_MAX_UPLOAD_BYTES,
  DETAIL_MAX_UPLOAD_PIXELS,
} from './detail-defaults'

export const DETAIL_IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
export const DETAIL_UPLOAD_TYPE_ERROR = '仅支持 PNG、JPEG 或 WebP 图片。'
export const DETAIL_UPLOAD_SIZE_ERROR = '上传图片超过大小限制。'
export const DETAIL_UPLOAD_DECODE_ERROR = '上传内容不是有效图片。'
export const DETAIL_STALE_ERROR = 'detail-editor-stale-transaction'

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10] as const

function startsWith(bytes: Uint8Array, magic: readonly number[]) {
  return magic.every((value, index) => bytes[index] === value)
}

export function sniffRasterMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && startsWith(bytes, PNG_MAGIC)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export function hasPngMagic(bytes: Uint8Array) {
  return bytes.length >= 8 && startsWith(bytes, PNG_MAGIC)
}

export function pngHasAlphaColorType(bytes: Uint8Array) {
  return hasPngMagic(bytes) && bytes.length > 25 && (bytes[25] === 4 || bytes[25] === 6)
}

export async function validateDetailUpload(file: File, kind: DetailResourceKind = 'upload'): Promise<DetailResource> {
  if (file.size <= 0) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  if (file.size > DETAIL_MAX_UPLOAD_BYTES) throw new Error(DETAIL_UPLOAD_SIZE_ERROR)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const decodedMime = sniffRasterMime(bytes)
  if (!decodedMime) throw new Error(DETAIL_UPLOAD_TYPE_ERROR)
  const declared = file.type.toLowerCase()
  if (declared && declared !== decodedMime) throw new Error(DETAIL_UPLOAD_TYPE_ERROR)
  const blob = new Blob([bytes], { type: decodedMime })
  const decoded = await decodeRasterBlob(blob, DETAIL_UPLOAD_DECODE_ERROR)
  const width = decoded.width
  const height = decoded.height
  decoded.close()
  if (width <= 0 || height <= 0 || width * height > DETAIL_MAX_UPLOAD_PIXELS) throw new Error(DETAIL_UPLOAD_SIZE_ERROR)
  const sha256 = await sha256Blob(blob)
  return {
    id: kind === 'poster-final' ? 'poster-final' : `${kind}:${sha256}`,
    kind,
    name: file.name || '上传图片',
    blob,
    sha256,
    mimeType: decodedMime,
    width,
    height,
  }
}

export async function validatePngBlob(
  blob: Blob,
  expected?: { width?: number; height?: number; sha256?: string; requireAlpha?: boolean },
) {
  if (blob.type !== 'image/png' || blob.size <= 0) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!hasPngMagic(bytes)) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  if (expected?.requireAlpha && !pngHasAlphaColorType(bytes)) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  const decoded = await decodeRasterBlob(blob, DETAIL_UPLOAD_DECODE_ERROR)
  const width = decoded.width
  const height = decoded.height
  decoded.close()
  if (expected?.width !== undefined && width !== expected.width) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  if (expected?.height !== undefined && height !== expected.height) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  const sha256 = await sha256Blob(blob)
  if (expected?.sha256 && sha256 !== expected.sha256) throw new Error(DETAIL_UPLOAD_DECODE_ERROR)
  return { bytes, width, height, sha256 }
}

export async function validateStepFiveEntryPoster(confirmed: ConfirmedPoster) {
  const validated = await validatePngBlob(confirmed.pngBlob, {
    width: 1024,
    height: 1536,
    sha256: confirmed.pngBlobSha256,
  })
  const owner: DetailOwnerIdentity = {
    generationId: confirmed.generationId,
    posterId: confirmed.posterId,
    inputSignatureSha256: confirmed.inputSignatureSha256,
    pngBlobSha256: validated.sha256,
  }
  const resource: DetailResource = {
    id: 'poster-final',
    kind: 'poster-final',
    name: '定稿海报',
    blob: confirmed.pngBlob,
    sha256: validated.sha256,
    mimeType: 'image/png',
    width: validated.width,
    height: validated.height,
  }
  return { owner, resource }
}

export async function validateDetailExport(blob: Blob) {
  return validatePngBlob(blob, { width: DETAIL_CANVAS_WIDTH, height: DETAIL_CANVAS_HEIGHT })
}

export function detailResourceByteIdentity(resource: DetailResource) {
  return `${resource.mimeType}:${resource.sha256}:${resource.width}x${resource.height}`
}

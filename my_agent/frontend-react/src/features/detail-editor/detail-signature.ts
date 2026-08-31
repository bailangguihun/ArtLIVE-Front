import type {
  DetailOwnerIdentity,
  DetailPage,
  DetailPageExport,
  DetailResource,
} from '../../types/detail-editor'
import { canonicalJson, sha256Text } from '../poster-editor/poster-signature'
import { DETAIL_CANVAS_HEIGHT, DETAIL_CANVAS_WIDTH, DETAIL_RENDERER_VERSION } from './detail-defaults'

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function normalizedDetailLayers(page: DetailPage) {
  return page.layers.map((layer) => {
    const transform = {
      left: finite(layer.left),
      top: finite(layer.top),
      angle: finite(layer.angle),
      scaleX: finite(layer.scaleX, 1),
      scaleY: finite(layer.scaleY, 1),
      originX: 'center' as const,
      originY: 'center' as const,
    }
    if (layer.kind === 'text') {
      return {
        id: layer.id,
        kind: layer.kind,
        text: String(layer.text),
        ...transform,
        fontId: layer.fontId,
        fontSize: finite(layer.fontSize, 36),
        fill: layer.fill,
        fontWeight: layer.fontWeight,
        fontStyle: layer.fontStyle,
        strokeEnabled: Boolean(layer.strokeEnabled),
        stroke: layer.stroke,
        strokeWidth: finite(layer.strokeWidth, 2),
      }
    }
    if (layer.kind === 'shape') {
      return {
        id: layer.id,
        kind: layer.kind,
        shapeKind: layer.shapeKind,
        ...transform,
        fill: layer.fill,
        stroke: layer.stroke,
        strokeWidth: finite(layer.strokeWidth, 3),
        opacity: finite(layer.opacity, 1),
        geometry: layer.geometry,
      }
    }
    return {
      id: layer.id,
      kind: layer.kind,
      resourceId: layer.resourceId,
      ...transform,
    }
  })
}

export function detailPageRenderInputs(
  page: DetailPage,
  resources: Readonly<Record<string, DetailResource>>,
) {
  const referencedImageHashes = page.layers
    .filter((layer) => layer.kind === 'image')
    .map((layer) => ({ resourceId: layer.resourceId, sha256: resources[layer.resourceId]?.sha256 ?? null }))
  return {
    background: {
      kind: page.background.kind,
      resourceId: page.background.resourceId,
      sha256: page.background.sha256,
      catalogId: page.background.kind === 'system' ? page.background.catalogId : null,
    },
    selectedFontId: page.selectedFontId,
    layers: normalizedDetailLayers(page),
    referencedImageHashes,
    width: DETAIL_CANVAS_WIDTH,
    height: DETAIL_CANVAS_HEIGHT,
    rendererVersion: DETAIL_RENDERER_VERSION,
  }
}

export function detailPageSignatureSha256(
  page: DetailPage,
  resources: Readonly<Record<string, DetailResource>>,
) {
  return sha256Text(canonicalJson(detailPageRenderInputs(page, resources)))
}

export function detailGroupSignatureSha256(
  owner: DetailOwnerIdentity,
  exports: readonly DetailPageExport[],
) {
  return sha256Text(canonicalJson({
    owner,
    pages: exports.map((item) => ({
      pageId: item.pageId,
      revision: item.revision,
      signatureSha256: item.signatureSha256,
      pngBlobSha256: item.pngBlobSha256,
      width: item.width,
      height: item.height,
    })),
  }))
}

export function sameDetailPagePixels(left: DetailPage, right: DetailPage) {
  return canonicalJson({
    background: left.background,
    selectedFontId: left.selectedFontId,
    layers: normalizedDetailLayers(left),
  }) === canonicalJson({
    background: right.background,
    selectedFontId: right.selectedFontId,
    layers: normalizedDetailLayers(right),
  })
}

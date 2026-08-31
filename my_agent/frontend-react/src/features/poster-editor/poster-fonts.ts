import type { CompletePosterLayout } from '../../types/poster-editor'

export interface PosterFontDefinition {
  id: string
  label: string
  family: string
  assetUrl: string
  sourceFile: string
}

// Derived from font_catalog.py source order and the project-local fonts/ folder.
// System fonts are intentionally excluded from the React editor.
export const AVAILABLE_POSTER_FONTS: readonly PosterFontDefinition[] = [
  {
    id: 'lxgw_wenkai',
    label: '霞鹜文楷',
    family: 'PosterEditor-lxgw_wenkai',
    assetUrl: '/fonts/poster-editor/LXGWWenKai-Regular.ttf',
    sourceFile: 'fonts/LXGWWenKai-Regular.ttf',
  },
  {
    id: 'zcool_xiaowei',
    label: '站酷小薇',
    family: 'PosterEditor-zcool_xiaowei',
    assetUrl: '/fonts/poster-editor/ZCOOLXiaoWei-Regular.ttf',
    sourceFile: 'fonts/ZCOOLXiaoWei-Regular.ttf',
  },
  {
    id: 'zcool_qingke',
    label: '站酷庆科黄油体',
    family: 'PosterEditor-zcool_qingke',
    assetUrl: '/fonts/poster-editor/ZCOOLQingKeHuangYou-Regular.ttf',
    sourceFile: 'fonts/ZCOOLQingKeHuangYou-Regular.ttf',
  },
  {
    id: 'ma_shan_zheng',
    label: '马善政毛笔楷书',
    family: 'PosterEditor-ma_shan_zheng',
    assetUrl: '/fonts/poster-editor/MaShanZheng-Regular.ttf',
    sourceFile: 'fonts/MaShanZheng-Regular.ttf',
  },
  {
    id: 'zhi_mang_xing',
    label: '志莽行书',
    family: 'PosterEditor-zhi_mang_xing',
    assetUrl: '/fonts/poster-editor/ZhiMangXing-Regular.ttf',
    sourceFile: 'fonts/ZhiMangXing-Regular.ttf',
  },
  {
    id: 'long_cang',
    label: '龙藏体',
    family: 'PosterEditor-long_cang',
    assetUrl: '/fonts/poster-editor/LongCang-Regular.ttf',
    sourceFile: 'fonts/LongCang-Regular.ttf',
  },
  {
    id: 'open_sans',
    label: 'Open Sans',
    family: 'PosterEditor-open_sans',
    assetUrl: '/fonts/poster-editor/OpenSans-Regular.ttf',
    sourceFile: 'fonts/OpenSans-Regular.ttf',
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    family: 'PosterEditor-montserrat',
    assetUrl: '/fonts/poster-editor/Montserrat-Regular.ttf',
    sourceFile: 'fonts/Montserrat-Regular.ttf',
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: 'PosterEditor-playfair',
    assetUrl: '/fonts/poster-editor/PlayfairDisplay-Regular.ttf',
    sourceFile: 'fonts/PlayfairDisplay-Regular.ttf',
  },
  {
    id: 'oswald',
    label: 'Oswald',
    family: 'PosterEditor-oswald',
    assetUrl: '/fonts/poster-editor/Oswald-Regular.ttf',
    sourceFile: 'fonts/Oswald-Regular.ttf',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    family: 'PosterEditor-merriweather',
    assetUrl: '/fonts/poster-editor/Merriweather-Regular.ttf',
    sourceFile: 'fonts/Merriweather-Regular.ttf',
  },
] as const

export const SOURCE_DEFAULT_FONT_ID = 'zcool_xiaowei'
export const FIRST_AVAILABLE_FONT_ID = AVAILABLE_POSTER_FONTS[0].id

const definitions = new Map(
  AVAILABLE_POSTER_FONTS.map((definition) => [definition.id, definition]),
)
const loadPromises = new Map<string, Promise<string>>()
const loadedFamilies = new Set<string>()

export function isAvailablePosterFont(fontId: string | null | undefined) {
  return Boolean(fontId && definitions.has(fontId))
}

export function resolveAvailableFontId(fontId: string | null | undefined) {
  return isAvailablePosterFont(fontId) ? fontId! : FIRST_AVAILABLE_FONT_ID
}

export function posterFontDefinition(fontId: string | null | undefined) {
  return definitions.get(resolveAvailableFontId(fontId))!
}

export function posterFontLabel(fontId: string | null | undefined) {
  return posterFontDefinition(fontId).label
}

export function posterFontFamily(fontId: string | null | undefined) {
  return posterFontDefinition(fontId).family
}

export function requiredLayoutFontIds(layout: CompletePosterLayout) {
  const ids = new Set<string>([resolveAvailableFontId(layout.fontId)])
  for (const box of layout.textBoxes) {
    ids.add(resolveAvailableFontId(box.fontId || layout.fontId))
  }
  return [...ids]
}

export async function ensurePosterFont(fontId: string) {
  const resolved = resolveAvailableFontId(fontId)
  const existing = loadPromises.get(resolved)
  if (existing) {
    return existing
  }

  const definition = posterFontDefinition(resolved)
  const promise = (async () => {
    if (
      typeof FontFace === 'undefined' ||
      typeof document === 'undefined' ||
      !document.fonts
    ) {
      return definition.family
    }
    if (!loadedFamilies.has(definition.family)) {
      const face = new FontFace(
        definition.family,
        `url("${definition.assetUrl}") format("truetype")`,
        { display: 'block', style: 'normal', weight: '400' },
      )
      await face.load()
      document.fonts.add(face)
      await document.fonts.load(`16px "${definition.family}"`)
      if (!document.fonts.check(`16px "${definition.family}"`)) {
        throw new Error('font unavailable')
      }
      loadedFamilies.add(definition.family)
    }
    return definition.family
  })()
  loadPromises.set(resolved, promise)
  try {
    return await promise
  } catch (error) {
    loadPromises.delete(resolved)
    throw error
  }
}

export async function ensureLayoutFonts(layout: CompletePosterLayout) {
  const resolved = new Map<string, string>()
  for (const id of requiredLayoutFontIds(layout)) {
    resolved.set(id, await ensurePosterFont(id))
  }
  return resolved
}

export function resetPosterFontLoadCache() {
  loadPromises.clear()
  loadedFamilies.clear()
}

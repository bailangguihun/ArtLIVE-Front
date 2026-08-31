import type {
  DetailBackground,
  DetailEditorState,
  DetailImageLayer,
  DetailOwnerIdentity,
  DetailPage,
  DetailResource,
  DetailShapeKind,
  DetailShapeLayer,
  DetailTextLayer,
} from '../../types/detail-editor'
import { createInitialDetailEditorState } from '../../types/detail-editor'

export const DETAIL_CANVAS_WIDTH = 750 as const
export const DETAIL_CANVAS_HEIGHT = 1334 as const
export const DETAIL_RENDERER_VERSION = 'detail-canvas-v1'
export const DETAIL_DEFAULT_FONT_ID = 'zcool_xiaowei'
export const DETAIL_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const DETAIL_MAX_UPLOAD_PIXELS = 40_000_000

export interface DetailBackgroundDefinition {
  id: string
  label: string
  resourceId: string
  url: string
  sha256: string
  width: 750
  height: 1334
}

const backgroundUrls = {
  '01': new URL('../../../../assets/detail_backgrounds/01.png', import.meta.url).href,
  '02': new URL('../../../../assets/detail_backgrounds/02.png', import.meta.url).href,
  '03': new URL('../../../../assets/detail_backgrounds/03.png', import.meta.url).href,
  '04': new URL('../../../../assets/detail_backgrounds/04.png', import.meta.url).href,
  '05': new URL('../../../../assets/detail_backgrounds/05.png', import.meta.url).href,
  '06': new URL('../../../../assets/detail_backgrounds/06.png', import.meta.url).href,
  '07': new URL('../../../../assets/detail_backgrounds/07.png', import.meta.url).href,
  '08': new URL('../../../../assets/detail_backgrounds/08.png', import.meta.url).href,
  '09': new URL('../../../../assets/detail_backgrounds/09.png', import.meta.url).href,
  '10': new URL('../../../../assets/detail_backgrounds/10.png', import.meta.url).href,
  '11': new URL('../../../../assets/detail_backgrounds/11.png', import.meta.url).href,
  '12': new URL('../../../../assets/detail_backgrounds/12.png', import.meta.url).href,
  '13': new URL('../../../../assets/detail_backgrounds/13.png', import.meta.url).href,
  '14': new URL('../../../../assets/detail_backgrounds/14.png', import.meta.url).href,
  '15': new URL('../../../../assets/detail_backgrounds/15.png', import.meta.url).href,
  '16': new URL('../../../../assets/detail_backgrounds/16.png', import.meta.url).href,
  '17': new URL('../../../../assets/detail_backgrounds/17.png', import.meta.url).href,
  '18': new URL('../../../../assets/detail_backgrounds/18.png', import.meta.url).href,
  '19': new URL('../../../../assets/detail_backgrounds/19.png', import.meta.url).href,
  '20': new URL('../../../../assets/detail_backgrounds/20.png', import.meta.url).href,
} as const

const backgroundHashes = {
  '01': '2aac316ac50563e96d6e97cc1bc35561de94f170d638d495e0862969cfc136ea',
  '02': 'cbf47114be40f581521ec3c2cafda5b6abd1041e22c8238ce9b92d2bc31c62e9',
  '03': '33bb90287b583f2831e1ef638f79a68e72fd8bc194a7776367f4dc535c96394c',
  '04': '8eb3c10524e245429fb654b83ef0b12e938a9c3cbdefdc0ddd09995d73cc67de',
  '05': '5138da84ca64b2c8c63965e04d2d4be6a39c85c78d49e49c08a3922e002eadfd',
  '06': '3f52af064266f2e9ee7ec22ebf91850033bc5033d749470c72acee6864befe70',
  '07': '46f62effd4fe4f1e3ca253baba26716bb95d5ed930aedd95895d977a7eecebf3',
  '08': '7a2df5e36b6bc43936e914ae0bc15876f05740cd7a250fdec0158041e30eeb7e',
  '09': '3c6bcd1859d80431162e94163777d82177cdf118e79942385c976a0481a8e4a6',
  '10': '562e659082825d936b664b4bea2e42ab29078e34ee78a7cc7bf0f068c439bf33',
  '11': '96af425578a5e657d9c63b8be45b03ae23f57f604e1c0ec76b6b9cb3e4b3bad9',
  '12': 'c95a46e890d30d849c332374f932cda2f7aea180b7652cb89ab582e1f854aff2',
  '13': '46c556fbf7c3076100b3589b545514ec730b10903b9005aa07358d22bc11ba33',
  '14': '0511c9bd29412da7d9c0e01b0e4765b707827c0876c052226a13eedabafabd56',
  '15': '555e08d38420ace61e17c504a2c8e95ec25e3b3acbd220f7e617715225bbd7b2',
  '16': '279fb66dc8e9a2e4620e6c1502788efdad9c35b285bc00c00e4890bbaccc6954',
  '17': 'deb40b497a7165c331ea82a9990af820c05dfad43c8dbe6581b290b9f624aeb0',
  '18': '16df3ae3dbf57b0d0d82430d7cc53b0250648ac428d7fb92d8c7f62162cf0d30',
  '19': 'd7e42279472f37810cd412fb97b4a2b7b874a49f6329ebb6c7e2d07d34e01069',
  '20': '17518b59868dfe08bcec199f63fbf38610e1a6a0ff3162f5cd079b1fb858dfd9',
} as const

const backgroundSourceOrder = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
] as const

export const DETAIL_BACKGROUNDS: readonly DetailBackgroundDefinition[] =
  backgroundSourceOrder.map((id) => ({
    id,
    label: id,
    resourceId: `background-system-${id}`,
    url: backgroundUrls[id],
    sha256: backgroundHashes[id],
    width: DETAIL_CANVAS_WIDTH,
    height: DETAIL_CANVAS_HEIGHT,
  }))

const backgroundsById = new Map(DETAIL_BACKGROUNDS.map((item) => [item.id, item]))

export function detailBackgroundDefinition(id: string | null | undefined) {
  return backgroundsById.get(id ?? '') ?? DETAIL_BACKGROUNDS[0]
}

export function systemBackground(id = '01'): DetailBackground {
  const definition = detailBackgroundDefinition(id)
  return {
    kind: 'system',
    catalogId: definition.id,
    resourceId: definition.resourceId,
    sha256: definition.sha256,
  }
}

export interface DetailFontDefinition {
  id: string
  label: string
  family: string
  assetUrl?: string
}

export const DETAIL_FONTS: readonly DetailFontDefinition[] = [
  { id: 'lxgw_wenkai', label: '霞鹜文楷', family: 'DetailEditor-lxgw_wenkai', assetUrl: '/fonts/poster-editor/LXGWWenKai-Regular.ttf' },
  { id: 'zcool_xiaowei', label: '站酷小薇', family: 'DetailEditor-zcool_xiaowei', assetUrl: '/fonts/poster-editor/ZCOOLXiaoWei-Regular.ttf' },
  { id: 'zcool_qingke', label: '站酷庆科黄油体', family: 'DetailEditor-zcool_qingke', assetUrl: '/fonts/poster-editor/ZCOOLQingKeHuangYou-Regular.ttf' },
  { id: 'ma_shan_zheng', label: '马善政毛笔楷书', family: 'DetailEditor-ma_shan_zheng', assetUrl: '/fonts/poster-editor/MaShanZheng-Regular.ttf' },
  { id: 'zhi_mang_xing', label: '志莽行书', family: 'DetailEditor-zhi_mang_xing', assetUrl: '/fonts/poster-editor/ZhiMangXing-Regular.ttf' },
  { id: 'long_cang', label: '龙藏体', family: 'DetailEditor-long_cang', assetUrl: '/fonts/poster-editor/LongCang-Regular.ttf' },
  { id: 'msyh', label: '微软雅黑', family: 'Microsoft YaHei' },
  { id: 'msyhbd', label: '微软雅黑 Bold', family: 'Microsoft YaHei' },
  { id: 'simhei', label: '黑体', family: 'SimHei' },
  { id: 'simsun', label: '宋体', family: 'SimSun' },
  { id: 'simkai', label: '楷体', family: 'KaiTi' },
  { id: 'simfang', label: '仿宋', family: 'FangSong' },
  { id: 'dengxian', label: '等线（Deng.ttf）', family: 'DengXian' },
  { id: 'stzhongs', label: '华文中宋', family: 'STZhongsong' },
  { id: 'stkaiti', label: '华文楷体', family: 'STKaiti' },
  { id: 'stxingkai', label: '华文行楷', family: 'STXingkai' },
  { id: 'open_sans', label: 'Open Sans', family: 'DetailEditor-open_sans', assetUrl: '/fonts/poster-editor/OpenSans-Regular.ttf' },
  { id: 'montserrat', label: 'Montserrat', family: 'DetailEditor-montserrat', assetUrl: '/fonts/poster-editor/Montserrat-Regular.ttf' },
  { id: 'lora', label: 'Lora（georgia.ttf）', family: 'Georgia' },
  { id: 'playfair', label: 'Playfair Display', family: 'DetailEditor-playfair', assetUrl: '/fonts/poster-editor/PlayfairDisplay-Regular.ttf' },
  { id: 'oswald', label: 'Oswald', family: 'DetailEditor-oswald', assetUrl: '/fonts/poster-editor/Oswald-Regular.ttf' },
  { id: 'merriweather', label: 'Merriweather', family: 'DetailEditor-merriweather', assetUrl: '/fonts/poster-editor/Merriweather-Regular.ttf' },
  { id: 'arial', label: 'Arial', family: 'Arial' },
  { id: 'verdana', label: 'Verdana', family: 'Verdana' },
] as const

const fontsById = new Map(DETAIL_FONTS.map((font) => [font.id, font]))
const fontPromises = new Map<string, Promise<string>>()

export function detailFont(id: string | null | undefined) {
  return fontsById.get(id ?? '') ?? fontsById.get(DETAIL_DEFAULT_FONT_ID)!
}

export async function ensureDetailFont(id: string) {
  const font = detailFont(id)
  if (!font.assetUrl || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return font.family
  const prior = fontPromises.get(font.id)
  if (prior) return prior
  const promise = (async () => {
    const face = new FontFace(font.family, `url("${font.assetUrl}") format("truetype")`, { display: 'block', weight: '400' })
    await face.load()
    document.fonts.add(face)
    await document.fonts.load(`16px "${font.family}"`)
    return font.family
  })()
  fontPromises.set(font.id, promise)
  try {
    return await promise
  } catch (error) {
    fontPromises.delete(font.id)
    throw error
  }
}

export function sameDetailOwner(left: DetailOwnerIdentity | null, right: DetailOwnerIdentity | null) {
  return Boolean(left && right && left.generationId === right.generationId && left.posterId === right.posterId && left.inputSignatureSha256 === right.inputSignatureSha256 && left.pngBlobSha256 === right.pngBlobSha256)
}

export function createTextLayer(id: string, fontId = DETAIL_DEFAULT_FONT_ID): DetailTextLayer {
  return {
    id, kind: 'text', text: '双击编辑文字', left: 375, top: 960.48,
    fontId, fontSize: 36, fill: '#222222', fontWeight: 'normal', fontStyle: 'normal',
    strokeEnabled: false, stroke: '#000000', strokeWidth: 2,
    angle: 0, scaleX: 1, scaleY: 1, originX: 'center', originY: 'center',
  }
}

export function createShapeLayer(id: string, shapeKind: DetailShapeKind): DetailShapeLayer {
  const common = {
    id, kind: 'shape' as const, shapeKind, left: 375, top: 600.3, angle: 0,
    scaleX: 1, scaleY: 1, originX: 'center' as const, originY: 'center' as const,
    fill: shapeKind === 'line' ? '' : '#222222', stroke: shapeKind === 'line' ? '#222222' : '#111111',
    strokeWidth: shapeKind === 'line' ? 4 : 3,
    opacity: shapeKind === 'line' ? 1 : shapeKind === 'star' || shapeKind === 'diamond' ? 0.9 : 0.85,
  }
  if (shapeKind === 'line') return { ...common, geometry: { points: [-120, 0, 120, 0] as const } }
  if (shapeKind === 'ellipse') return { ...common, geometry: { rx: 110, ry: 70 } }
  if (shapeKind === 'star') return { ...common, geometry: { outerRadius: 70, innerRadius: 30, spikes: 5 } }
  return { ...common, geometry: { width: shapeKind === 'diamond' ? 160 : 220, height: shapeKind === 'diamond' ? 200 : 120 } }
}

export function createImageLayer(id: string, resource: DetailResource, existingCount: number): DetailImageLayer {
  const scale = Math.min(1, (DETAIL_CANVAS_WIDTH * 0.62) / resource.width, (DETAIL_CANVAS_HEIGHT * 0.55) / resource.height)
  return {
    id, kind: 'image', resourceId: resource.id,
    left: 375 + (existingCount % 3) * 36 - 36,
    top: DETAIL_CANVAS_HEIGHT * 0.42 + (existingCount % 3) * 36,
    angle: 0, scaleX: scale, scaleY: scale, originX: 'center', originY: 'center',
  }
}

export function createInitialDetailEditor(owner: DetailOwnerIdentity, poster: DetailResource): DetailEditorState {
  const initial = createInitialDetailEditorState()
  const pageId = `page-${owner.generationId}-${owner.posterId}-1`
  const layer = createImageLayer('image-poster-final-1', poster, 0)
  const page: DetailPage = {
    id: pageId,
    background: systemBackground('01'),
    activeProductId: poster.id,
    selectedFontId: DETAIL_DEFAULT_FONT_ID,
    layers: [layer],
    compositionRevision: 0,
    currentExport: null,
  }
  return {
    ...initial,
    owner: { ...owner },
    pages: [page],
    resources: { [poster.id]: poster },
    resourceRevision: 1,
    selectedLayerId: layer.id,
    selectedResourceId: poster.id,
    nextPageSequence: 2,
    nextLayerSequence: 2,
  }
}

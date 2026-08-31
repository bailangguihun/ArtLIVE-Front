import type { CopyVariant, PlatformId } from '../../types/platform-copy'
import type {
  CompletePosterLayout,
  PosterShape,
  PosterShapeType,
  PosterTextBox,
} from '../../types/poster-editor'
import {
  FIRST_AVAILABLE_FONT_ID,
  isAvailablePosterFont,
} from './poster-fonts'

interface PlatformPreset {
  preferredFontId: string
  align: 'left' | 'center'
  textColor: string
  accentColor: string
  positions: readonly (readonly [number, number])[]
  sizes: readonly [number, number, number]
}

const TOP_LEFT = [
  [0.08, 0.08],
  [0.08, 0.15],
  [0.08, 0.21],
] as const
const TOP_CENTER = [
  [0.5, 0.08],
  [0.5, 0.15],
  [0.5, 0.21],
] as const
const BOTTOM_CENTER = [
  [0.5, 0.78],
  [0.5, 0.85],
  [0.5, 0.91],
] as const

export const PLATFORM_POSTER_PRESETS: Record<PlatformId, PlatformPreset> = {
  xiaohongshu: {
    preferredFontId: 'lxgw_wenkai',
    align: 'left',
    textColor: '#333333',
    accentColor: '#FF2442',
    positions: TOP_LEFT,
    sizes: [64, 36, 28],
  },
  douyin: {
    preferredFontId: 'msyhbd',
    align: 'center',
    textColor: '#FFFFFF',
    accentColor: '#FE2C55',
    positions: BOTTOM_CENTER,
    sizes: [70, 40, 30],
  },
  taobao: {
    preferredFontId: 'noto_sans_sc',
    align: 'left',
    textColor: '#111111',
    accentColor: '#FF5000',
    positions: TOP_LEFT,
    sizes: [60, 36, 28],
  },
  pinduoduo: {
    preferredFontId: 'zcool_qingke',
    align: 'center',
    textColor: '#E02E24',
    accentColor: '#E02E24',
    positions: TOP_CENTER,
    sizes: [72, 42, 30],
  },
}

export function resolvedPlatformFontId(platform: PlatformId) {
  const preferred = PLATFORM_POSTER_PRESETS[platform].preferredFontId
  return isAvailablePosterFont(preferred) ? preferred : FIRST_AVAILABLE_FONT_ID
}

/** Empty layout used when a provider-rendered poster is confirmed without local editing. */
export function createProviderDirectPosterLayout(
  platform: PlatformId,
): CompletePosterLayout {
  return {
    fontId: resolvedPlatformFontId(platform),
    textBoxes: [],
    shapes: [],
    images: [],
  }
}

export function createDefaultPosterLayout(
  platform: PlatformId,
  copy: CopyVariant | null,
): CompletePosterLayout {
  const preset = PLATFORM_POSTER_PRESETS[platform]
  const roles = ['title', 'headline', 'subline'] as const
  const values = [copy?.title ?? '', copy?.headline ?? '', copy?.subline ?? '']
  const colors = [preset.textColor, preset.accentColor, preset.textColor]
  const textBoxes: PosterTextBox[] = roles.map((role, index) => ({
    id: `box-${role}`,
    role,
    text: String(values[index] || ''),
    fontId: null,
    fontSize: preset.sizes[index],
    color: colors[index],
    align: preset.align,
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    showBox: false,
    x: preset.positions[index][0],
    y: preset.positions[index][1],
  }))
  return {
    fontId: resolvedPlatformFontId(platform),
    textBoxes,
    shapes: [],
    images: [],
  }
}

export function createCustomTextBox(index: number): PosterTextBox {
  return {
    id: `box-custom-${globalThis.crypto.randomUUID()}`,
    role: `custom-${index}`,
    text: '',
    fontId: null,
    fontSize: 36,
    color: '#FFFFFF',
    align: 'center',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    showBox: false,
    x: 0.5,
    y: Math.min(0.92, 0.28 + 0.08 * ((index - 1) % 6)),
  }
}

export function createDefaultShape(type: PosterShapeType, id: string): PosterShape {
  if (type === 'line') {
    return {
      id,
      type,
      x: 0.25,
      y: 0.5,
      w: 0.5,
      h: 0,
      rotation: 0,
      fill: '#FFFFFF',
      fillOpacity: 0,
      stroke: '#111111',
      strokeWidth: 4,
      strokeOpacity: 1,
    }
  }
  return {
    id,
    type,
    x: 0.3,
    y: 0.4,
    w: 0.4,
    h: 0.18,
    rotation: 0,
    fill: '#FFFFFF',
    fillOpacity: 0.35,
    stroke: '#111111',
    strokeWidth: 3,
    strokeOpacity: 1,
  }
}

export const SHAPE_ADD_OPTIONS: readonly {
  type: PosterShapeType
  label: string
}[] = [
  { type: 'rect', label: '矩形' },
  { type: 'ellipse', label: '椭圆' },
  { type: 'line', label: '直线' },
  { type: 'star', label: '五角星' },
  { type: 'diamond', label: '菱形' },
]

export const SHAPE_LABELS: Record<PosterShapeType, string> = {
  rect: '矩形',
  ellipse: '椭圆',
  line: '直线',
  star: '五角星',
  diamond: '菱形',
}

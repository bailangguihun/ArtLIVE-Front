import type { PosterStyleTemplateId } from '../../types/poster-style-template'

export type PosterStyleTemplateOptionId = 'smart_match' | PosterStyleTemplateId

export interface PosterStyleTemplateOption {
  readonly optionId: PosterStyleTemplateOptionId
  readonly styleTemplateId: PosterStyleTemplateId | null
  readonly alias: string
  readonly description: string
  readonly previewKind: 'auto' | 'asset'
  readonly previewUrl: string | null
  readonly accessibilityText: string
}

const paperDoodleGridPreviewUrl = new URL(
  '../../../../assets/poster_style_templates/paper_doodle_grid.svg',
  import.meta.url,
).href

const warmCollectiblePosterPreviewUrl = new URL(
  '../../../../assets/poster_style_templates/warm_collectible_poster.svg',
  import.meta.url,
).href

const softFloralFlatlayPreviewUrl = new URL(
  '../../../../assets/poster_style_templates/soft_floral_flatlay.svg',
  import.meta.url,
).href

export const POSTER_STYLE_TEMPLATE_OPTIONS: readonly PosterStyleTemplateOption[] = [
  {
    optionId: 'smart_match',
    styleTemplateId: null,
    alias: '智能匹配',
    description: '不使用固定模板，保留当前海报生成逻辑。',
    previewKind: 'auto',
    previewUrl: null,
    accessibilityText: '智能匹配：不使用固定风格模板',
  },
  {
    optionId: 'paper_doodle_grid',
    styleTemplateId: 'paper_doodle_grid',
    alias: '纸上奇想四格',
    description: '暖白纸张、真实产品、黑色涂鸦与四宫格互动。',
    previewKind: 'asset',
    previewUrl: paperDoodleGridPreviewUrl,
    accessibilityText: '纸上奇想四格：暖白纸张、真实产品、黑色涂鸦与四宫格互动',
  },
  {
    optionId: 'warm_collectible_poster',
    styleTemplateId: 'warm_collectible_poster',
    alias: '收藏级暖白海报',
    description: '暖白纸张、真实产品主视觉与黑色手绘涂鸦互动。',
    previewKind: 'asset',
    previewUrl: warmCollectiblePosterPreviewUrl,
    accessibilityText: '收藏级暖白海报：暖白纸张、真实产品主视觉与黑色手绘涂鸦互动',
  },
  {
    optionId: 'soft_floral_flatlay',
    styleTemplateId: 'soft_floral_flatlay',
    alias: '柔光粉白花漾',
    description: '粉白柔光、白花平铺与宁静奢华护发氛围。',
    previewKind: 'asset',
    previewUrl: softFloralFlatlayPreviewUrl,
    accessibilityText: '柔光粉白花漾：粉白柔光、白花平铺与宁静奢华护发氛围',
  },
]

import type { PosterStyleTemplateId } from '../../types/poster-style-template'
import { describe, expect, it } from 'vitest'
import {
  POSTER_STYLE_TEMPLATE_OPTIONS,
} from './poster-style-templates'

describe('poster style template catalog', () => {
  it('has unique UI options and exposes only the approved semantic template', () => {
    const optionIds = POSTER_STYLE_TEMPLATE_OPTIONS.map((option) => option.optionId)
    const semanticIds = POSTER_STYLE_TEMPLATE_OPTIONS
      .map((option) => option.styleTemplateId)
      .filter((value): value is PosterStyleTemplateId => value !== null)

    expect(new Set(optionIds).size).toBe(optionIds.length)
    expect(semanticIds).toEqual([
      'paper_doodle_grid',
      'warm_collectible_poster',
      'soft_floral_flatlay',
    ])
    expect(POSTER_STYLE_TEMPLATE_OPTIONS[0]).toMatchObject({
      optionId: 'smart_match',
      styleTemplateId: null,
      alias: '智能匹配',
      previewKind: 'auto',
      previewUrl: null,
    })
    expect(POSTER_STYLE_TEMPLATE_OPTIONS[1]).toMatchObject({
      optionId: 'paper_doodle_grid',
      styleTemplateId: 'paper_doodle_grid',
      alias: '纸上奇想四格',
      description: '暖白纸张、真实产品、黑色涂鸦与四宫格互动。',
      previewKind: 'asset',
    })
    expect(POSTER_STYLE_TEMPLATE_OPTIONS[2]).toMatchObject({
      optionId: 'warm_collectible_poster',
      styleTemplateId: 'warm_collectible_poster',
      alias: '收藏级暖白海报',
      description: '暖白纸张、真实产品主视觉与黑色手绘涂鸦互动。',
      previewKind: 'asset',
    })
    expect(POSTER_STYLE_TEMPLATE_OPTIONS[3]).toMatchObject({
      optionId: 'soft_floral_flatlay',
      styleTemplateId: 'soft_floral_flatlay',
      alias: '柔光粉白花漾',
      description: '粉白柔光、白花平铺与宁静奢华护发氛围。',
      previewKind: 'asset',
    })
    for (const option of POSTER_STYLE_TEMPLATE_OPTIONS.slice(1)) {
      expect(option.previewUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    }
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureLayoutFonts,
  ensurePosterFont,
  posterFontDefinition,
  requiredLayoutFontIds,
  resetPosterFontLoadCache,
} from './poster-fonts'
import { createDefaultPosterLayout } from './poster-defaults'

describe('approved local font loading', () => {
  const add = vi.fn()
  const loadSet = vi.fn(async () => [])
  const check = vi.fn(() => true)
  const faceLoad = vi.fn(async function (this: { family: string }) { return this })
  const constructor = vi.fn(function (this: { family: string; source: string }, family: string, source: string) {
    this.family = family
    this.source = source
    return { family, source, load: faceLoad }
  })

  beforeEach(() => {
    resetPosterFontLoadCache()
    add.mockReset()
    loadSet.mockReset().mockResolvedValue([])
    check.mockReset().mockReturnValue(true)
    faceLoad.mockReset().mockImplementation(async function (this: { family: string }) { return this })
    constructor.mockClear()
    vi.stubGlobal('FontFace', constructor)
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add, load: loadSet, check },
    })
  })

  it('loads the exact selected local asset and deduplicates concurrent requests', async () => {
    const definition = posterFontDefinition('zcool_qingke')
    const [left, right] = await Promise.all([
      ensurePosterFont('zcool_qingke'),
      ensurePosterFont('zcool_qingke'),
    ])
    expect(left).toBe(definition.family)
    expect(right).toBe(definition.family)
    expect(constructor).toHaveBeenCalledTimes(1)
    expect(constructor).toHaveBeenCalledWith(
      definition.family,
      `url("${definition.assetUrl}") format("truetype")`,
      { display: 'block', style: 'normal', weight: '400' },
    )
    expect(faceLoad).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('awaits default and per-box exact families with deterministic order', async () => {
    const layout = createDefaultPosterLayout('xiaohongshu', null)
    layout.textBoxes[0] = { ...layout.textBoxes[0], fontId: 'merriweather' }
    expect(requiredLayoutFontIds(layout)).toEqual(['lxgw_wenkai', 'merriweather'])
    const loaded = await ensureLayoutFonts(layout)
    expect([...loaded.keys()]).toEqual(['lxgw_wenkai', 'merriweather'])
  })

  it('fails closed instead of silently exporting with another font', async () => {
    faceLoad.mockRejectedValueOnce(new Error('local font unavailable'))
    await expect(ensurePosterFont('oswald')).rejects.toThrow('local font unavailable')
    expect(add).not.toHaveBeenCalled()
  })
})

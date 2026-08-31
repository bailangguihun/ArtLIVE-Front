export const POSTER_STYLE_TEMPLATE_IDS = [
  'paper_doodle_grid',
  'warm_collectible_poster',
  'soft_floral_flatlay',
] as const

export type PosterStyleTemplateId = typeof POSTER_STYLE_TEMPLATE_IDS[number]

export function isPosterStyleTemplateId(
  value: unknown,
): value is PosterStyleTemplateId {
  return typeof value === 'string' &&
    (POSTER_STYLE_TEMPLATE_IDS as readonly string[]).includes(value)
}

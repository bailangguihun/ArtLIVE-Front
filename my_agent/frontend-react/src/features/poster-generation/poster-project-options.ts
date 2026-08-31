import type { PosterStyleTemplateId } from '../../types/poster-style-template'
import {
  copyRefFromConfirmedCopy,
  createPosterProjectInput,
  isAdviceCurrentForBasic,
  isPosterProjectCurrent,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type {
  AdviceAuthority,
  BasicAuthority,
  ConfirmedCopy,
  PosterGenerationKind,
  PosterProjectInput,
  PosterTypographyMode,
} from '../../state/workflow-v2/workflow-v2-types'
import { POSTER_STYLE_TEMPLATE_OPTIONS } from './poster-style-templates'

export const DEFAULT_POSTER_GENERATION_KIND: PosterGenerationKind = 'blank_base'
export const DEFAULT_POSTER_TYPOGRAPHY_MODE: PosterTypographyMode = 'textless'

export function defaultTemplateId(): PosterStyleTemplateId | null {
  const first = POSTER_STYLE_TEMPLATE_OPTIONS.find(
    (option) => option.styleTemplateId !== null,
  )
  return first?.styleTemplateId ?? null
}

export function posterCopyBinding(confirmedCopy: ConfirmedCopy | null) {
  if (!confirmedCopy) {
    return { copySource: 'poster_owned' as const, copyRef: undefined }
  }
  return {
    copySource: 'confirmed_copy' as const,
    copyRef: copyRefFromConfirmedCopy(confirmedCopy),
  }
}

export function providerDirectPosterEnabled(project: PosterProjectInput | null | undefined) {
  return project?.generationKind === 'template' && project.typographyMode === 'with_text'
}

export function posterProjectNeedsRefresh(
  project: PosterProjectInput | null,
  basic: BasicAuthority,
  advice: AdviceAuthority,
  confirmedCopy: ConfirmedCopy | null,
): boolean {
  if (!project || !isPosterProjectCurrent(project, basic, advice, confirmedCopy)) {
    return true
  }
  const binding = posterCopyBinding(confirmedCopy)
  if (project.copySource !== binding.copySource) return true
  if (!binding.copyRef) return project.copyRef !== null
  if (!project.copyRef) return true
  return (
    project.copyRef.outputSignatureSha256 !== binding.copyRef.outputSignatureSha256 ||
    project.copyRef.revision !== binding.copyRef.revision
  )
}

export async function createPosterProjectWithOptions(input: {
  readonly projectId: string
  readonly basic: BasicAuthority
  readonly advice: AdviceAuthority
  readonly confirmedCopy: ConfirmedCopy | null
  readonly generationKind: PosterGenerationKind
  readonly typographyMode: PosterTypographyMode
  readonly styleTemplateId: PosterStyleTemplateId | null
}): Promise<PosterProjectInput> {
  const copy = posterCopyBinding(input.confirmedCopy)
  const typographyMode =
    input.generationKind === 'blank_base' ? 'textless' : input.typographyMode
  const styleTemplateId =
    input.generationKind === 'blank_base' ? null : input.styleTemplateId
  return createPosterProjectInput({
    projectId: input.projectId,
    basic: input.basic,
    advice: input.advice,
    copySource: copy.copySource,
    copyRef: copy.copyRef,
    generationKind: input.generationKind,
    typographyMode,
    styleTemplateId,
  })
}

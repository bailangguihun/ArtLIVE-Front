import type { PlatformCopyCompletedDraft } from '../../types/platform-copy'
import {
  POSTER_SEQUENCE_MODE,
  type SequencePayload,
} from '../../types/poster-generation'
import type { ProductInfoValues } from '../../types/product-info'
import type {
  ConfirmedCopy,
  PosterProjectInput,
  PresentAdviceAuthority,
} from '../../state/workflow-v2/workflow-v2-types'
import { confirmedCopyMatchesRef } from '../../state/workflow-v2/workflow-v2-authorities'

export function buildPosterSequencePayload(
  values: ProductInfoValues,
  copy: PlatformCopyCompletedDraft,
): SequencePayload {
  return {
    product_info: values.productInfo.trim(),
    product_short_name: values.productShortName,
    creative_note: values.creativeNote,
    visual_style: copy.style,
    target_platform: copy.platform,
    generate_poster: true,
    generation_mode: POSTER_SEQUENCE_MODE,
    send_product_to_provider: true,
    requested_poster_count: 3,
    text_rendering_mode: 'local',
    output_size: '1024x1536',
    prefilled_copy_body: copy.copyDraft,
    prefilled_copy_title: String(copy.platformCopy.title ?? ''),
    prefilled_copy_headline: String(copy.platformCopy.headline ?? ''),
    prefilled_copy_subline: String(copy.platformCopy.subline ?? ''),
  }
}

function copyRefPayload(copy: ConfirmedCopy) {
  const ref = {
    version: 'workflow-v2-copy-ref-v1' as const,
    copy_authority_version: 'workflow-v2-confirmed-copy-v1' as const,
    revision: copy.revision,
    basic_owner: {
      text_signature_sha256: copy.input.basicOwner.textSignatureSha256,
      settings_signature_sha256: copy.input.basicOwner.settingsSignatureSha256,
    },
    advice_owner: copy.input.adviceOwner.kind === 'present'
      ? {
          kind: copy.input.adviceOwner.kind,
          authority_version: copy.input.adviceOwner.authorityVersion,
          advice_version: copy.input.adviceOwner.adviceVersion,
          input_signature_sha256: copy.input.adviceOwner.inputSignatureSha256,
          advice_signature_sha256: copy.input.adviceOwner.adviceSignatureSha256,
          owner_signature_sha256: copy.input.adviceOwner.ownerSignatureSha256,
        }
      : {
          kind: copy.input.adviceOwner.kind,
          authority_version: copy.input.adviceOwner.authorityVersion,
          advice_version: copy.input.adviceOwner.adviceVersion,
          input_signature_sha256: copy.input.adviceOwner.inputSignatureSha256,
          absent_reason: copy.input.adviceOwner.absentReason,
          owner_signature_sha256: copy.input.adviceOwner.ownerSignatureSha256,
        },
    input_signature_sha256: copy.input.inputSignatureSha256,
    output_signature_sha256: copy.outputSignatureSha256,
  }
  return ref
}

/**
 * V2 serial-poster payload. Copy provenance is automatic (confirmed copy when
 * present, otherwise poster-owned). Generation kind / typography control the
 * visual path and whether local editing is required afterward.
 */
export function buildV2PosterSequencePayload(
  values: ProductInfoValues,
  project: PosterProjectInput,
  advice: PresentAdviceAuthority,
  confirmedCopy: ConfirmedCopy | null,
): SequencePayload {
  const typographyMode =
    project.generationKind === 'blank_base' ? 'textless' : project.typographyMode
  const base: SequencePayload = {
    product_info: values.productInfo.trim(),
    product_short_name: values.productShortName,
    creative_note: values.creativeNote,
    visual_style: project.style,
    target_platform: project.platform,
    generate_poster: true,
    generation_mode: POSTER_SEQUENCE_MODE,
    send_product_to_provider: true,
    requested_poster_count: 3,
    text_rendering_mode: 'local',
    output_size: '1024x1536',
    prefilled_copy_body: '',
    prefilled_copy_title: '',
    prefilled_copy_headline: '',
    prefilled_copy_subline: '',
    marketing_advice_ref: {
      advice_version: advice.adviceVersion,
      input_signature_sha256: advice.inputSignatureSha256,
      advice_signature_sha256: advice.adviceSignatureSha256,
    },
  }
  if (project.generationKind === 'template' && project.styleTemplateId) {
    base.style_template_id = project.styleTemplateId
    base.sequence_typography_mode = typographyMode
  }
  if (project.copySource === 'poster_owned') {
    return {
      ...base,
      v2_poster_copy_source: { mode: 'poster_owned' },
    }
  }
  if (!confirmedCopy || !project.copyRef || !confirmedCopyMatchesRef(confirmedCopy, project.copyRef)) {
    throw new TypeError('A current Confirmed Copy is required for this Poster source.')
  }
  const ref = copyRefPayload(confirmedCopy)
  return {
    ...base,
    prefilled_copy_body: confirmedCopy.body,
    prefilled_copy_title: confirmedCopy.title,
    prefilled_copy_headline: confirmedCopy.headline,
    prefilled_copy_subline: confirmedCopy.subline,
    v2_poster_copy_source: {
      mode: 'confirmed_copy',
      copy_ref: ref,
      frozen_copy: {
        body: confirmedCopy.body,
        title: confirmedCopy.title,
        headline: confirmedCopy.headline,
        subline: confirmedCopy.subline,
        platform: confirmedCopy.platform,
        style: confirmedCopy.style,
        source_copy_ref: ref,
      },
    },
  }
}

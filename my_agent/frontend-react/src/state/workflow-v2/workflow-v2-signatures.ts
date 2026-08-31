import { sha256Text } from '../../features/poster-editor/poster-signature'
import { sha256TextSync } from '../../features/marketing-strategy/marketing-strategy-model'
import { canonicalJson, normalizeMarketingAdviceInput } from './workflow-v2-canonical'
import type {
  AdviceOwner,
  AdviceResult,
  BasicTextValues,
  ConfirmedCopyFields,
  CopyInputAuthority,
  CopyRef,
  CopySourceIdentity,
  DetailOwner,
  PosterCopySnapshot,
  PosterProjectInput,
  ProductImageIdentity,
} from './workflow-v2-types'

export const SIGNATURE_DOMAINS = {
  adviceInput: 'marketing-advice-input-v1',
  adviceOwner: 'workflow-v2-advice-owner-v1',
  adviceAbsentOwner: 'workflow-v2-advice-absent-owner-v1',
  basicText: 'workflow-v2-basic-text-v1',
  basicSettings: 'workflow-v2-basic-settings-v1',
  productImage: 'workflow-v2-product-image-v1',
  copyInput: 'workflow-v2-copy-input-v1',
  confirmedCopyOutput: 'workflow-v2-confirmed-copy-output-v1',
  promotionalCopyArtifact: 'workflow-v2-result-promotional-copy-v1',
  posterProject: 'workflow-v2-poster-project-identity-v1',
  posterInput: 'workflow-v2-poster-input-v1',
  posterCopySnapshot: 'workflow-v2-poster-copy-snapshot-v1',
  confirmedPosterOutput: 'workflow-v2-confirmed-poster-output-v1',
  posterArtifact: 'workflow-v2-result-poster-v1',
  detailOwner: 'workflow-v2-detail-owner-v1',
  confirmedDetailOutput: 'workflow-v2-confirmed-detail-output-v1',
  detailArtifact: 'workflow-v2-result-detail-v1',
} as const

export function domainSeparatedSignatureSha256(
  domain: string,
  value: unknown,
): Promise<string> {
  if (!domain || domain.includes('|')) {
    throw new TypeError('A signature domain must be non-empty and must not contain |.')
  }
  return sha256Text(`${domain}|${canonicalJson(value)}`)
}

export function domainSeparatedSignatureSha256Sync(
  domain: string,
  value: unknown,
): string {
  if (!domain || domain.includes('|')) {
    throw new TypeError('A signature domain must be non-empty and must not contain |.')
  }
  return sha256TextSync(`${domain}|${canonicalJson(value)}`)
}

export function marketingAdviceInputSignatureSha256(
  input: BasicTextValues,
): Promise<string> {
  const normalized = normalizeMarketingAdviceInput(input)
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.adviceInput, {
    product_info: normalized.productInfo,
    product_short_name: normalized.productShortName,
    creative_note: normalized.creativeNote,
  })
}

export function basicTextSignatureSha256(
  input: BasicTextValues,
): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.basicText, input)
}

export function basicSettingsSignatureSha256(input: {
  readonly platform: string
  readonly style: string
}): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.basicSettings, input)
}

export function productImageSignatureSha256(
  input:
    | Readonly<{ kind: 'absent' }>
    | Readonly<{
        kind: 'present'
        byteSha256: string
        mimeType: string
        byteSize: number
      }>,
): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.productImage, input)
}

export function adviceOwnerIdentityPayload(owner: AdviceOwner) {
  return owner.kind === 'present'
    ? {
        kind: owner.kind,
        authorityVersion: owner.authorityVersion,
        adviceVersion: owner.adviceVersion,
        inputSignatureSha256: owner.inputSignatureSha256,
        adviceSignatureSha256: owner.adviceSignatureSha256,
      }
    : {
        kind: owner.kind,
        authorityVersion: owner.authorityVersion,
        adviceVersion: owner.adviceVersion,
        inputSignatureSha256: owner.inputSignatureSha256,
        absentReason: owner.absentReason,
      }
}

export function adviceOwnerSignatureSha256(input: {
  readonly inputSignatureSha256: string
  readonly adviceSignatureSha256: string
  readonly adviceVersion: string
  readonly advice: AdviceResult
}): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.adviceOwner, input)
}

export function absentAdviceOwnerSignatureSha256(input: {
  readonly inputSignatureSha256: string
  readonly adviceVersion: string
  readonly absentReason: string
}): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.adviceAbsentOwner, input)
}

export function copyInputSignatureSha256(
  input: Omit<CopyInputAuthority, 'inputSignatureSha256'>,
): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.copyInput,
    copyInputIdentityPayload(input),
  )
}

export function copyInputIdentityPayload(
  input: Omit<CopyInputAuthority, 'inputSignatureSha256'>,
) {
  return {
    version: input.version,
    basicOwner: input.basicOwner,
    adviceOwner: adviceOwnerIdentityPayload(input.adviceOwner),
    platform: input.platform,
    style: input.style,
  }
}

export function confirmedCopyOutputSignatureSha256(input: {
  readonly input: CopyInputAuthority
  readonly revision: number
  readonly platform: string
  readonly style: string
  readonly source: CopySourceIdentity
  readonly fields: ConfirmedCopyFields
}): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.confirmedCopyOutput,
    input,
  )
}

export function promotionalCopyArtifactSignatureSha256(input: {
  readonly outputSignatureSha256: string
  readonly inputSignatureSha256: string
  readonly revision: number
}): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.promotionalCopyArtifact,
    input,
  )
}

export function posterProjectIdentitySha256(
  projectId: string,
): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.posterProject, {
    projectId,
  })
}

export function productImageIdentityPayload(image: ProductImageIdentity) {
  return image.kind === 'present'
    ? {
        kind: image.kind,
        byteSha256: image.byteSha256,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        signatureSha256: image.signatureSha256,
      }
    : { kind: image.kind, signatureSha256: image.signatureSha256 }
}

export function copyRefIdentityPayload(copyRef: CopyRef | null) {
  if (!copyRef) return null
  return {
    version: copyRef.version,
    copyAuthorityVersion: copyRef.copyAuthorityVersion,
    revision: copyRef.revision,
    basicOwner: copyRef.basicOwner,
    adviceOwner: adviceOwnerIdentityPayload(copyRef.adviceOwner),
    inputSignatureSha256: copyRef.inputSignatureSha256,
    outputSignatureSha256: copyRef.outputSignatureSha256,
  }
}

export function posterInputSignatureSha256(
  input: Omit<PosterProjectInput, 'inputSignatureSha256'>,
): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.posterInput,
    posterInputIdentityPayload(input),
  )
}

export function posterInputIdentityPayload(
  input: Omit<PosterProjectInput, 'inputSignatureSha256'>,
) {
  return {
    version: input.version,
    projectId: input.projectId,
    projectIdentitySha256: input.projectIdentitySha256,
    basicOwner: {
      textSignatureSha256: input.basicOwner.textSignatureSha256,
      settingsSignatureSha256: input.basicOwner.settingsSignatureSha256,
      productImage: productImageIdentityPayload(input.basicOwner.productImage),
    },
    adviceOwner: adviceOwnerIdentityPayload(input.adviceOwner),
    platform: input.platform,
    style: input.style,
    copySource: input.copySource,
    copyRef: copyRefIdentityPayload(input.copyRef),
    generation_kind: input.generationKind,
    typography_mode: input.typographyMode,
    style_template_id: input.styleTemplateId,
  }
}

export function posterCopySnapshotSignatureSha256(
  input: Omit<PosterCopySnapshot, 'snapshotSignatureSha256'>,
): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.posterCopySnapshot,
    posterCopySnapshotIdentityPayload(input),
  )
}

export function posterCopySnapshotIdentityPayload(
  input: Omit<PosterCopySnapshot, 'snapshotSignatureSha256'>,
) {
  return {
    ...input,
    sourceCopyRef: copyRefIdentityPayload(input.sourceCopyRef),
  }
}

export function confirmedPosterOutputSignatureSha256(input: {
  readonly project: PosterProjectInput
  readonly generationId: string
  readonly posterId: string
  readonly slot: number
  readonly baseBlobSha256: string
  readonly layoutSha256: string
  readonly upstreamSha256: string
  readonly compositionInputSignatureSha256: string
  readonly pngBlobSha256: string
  readonly confirmedRevision: number
  readonly resourceRevision: number
  readonly copySnapshotSignatureSha256: string
}): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.confirmedPosterOutput,
    input,
  )
}

export function posterArtifactSignatureSha256(input: {
  readonly outputSignatureSha256: string
  readonly projectIdentitySha256: string
  readonly confirmedRevision: number
  readonly pngBlobSha256: string
}): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.posterArtifact, input)
}

export function detailOwnerSignatureSha256(
  input: Omit<DetailOwner, 'ownerSignatureSha256'>,
): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.detailOwner, input)
}

export function confirmedDetailOutputSignatureSha256(input: {
  readonly detailId: string
  readonly owner: DetailOwner
  readonly detailRevision: number
  readonly resourceRevision: number
  readonly pageSignatureSha256: readonly string[]
  readonly pngBlobSha256: readonly string[]
  readonly groupSignatureSha256: string
}): Promise<string> {
  return domainSeparatedSignatureSha256(
    SIGNATURE_DOMAINS.confirmedDetailOutput,
    input,
  )
}

export function detailArtifactSignatureSha256(input: {
  readonly outputSignatureSha256: string
  readonly posterOutputSignatureSha256: string
  readonly detailRevision: number
}): Promise<string> {
  return domainSeparatedSignatureSha256(SIGNATURE_DOMAINS.detailArtifact, input)
}

import { PRODUCT_INFO_LIMITS } from '../../types/product-info'
import { canonicalJson, normalizeMarketingAdviceInput } from './workflow-v2-canonical'
import {
  absentAdviceOwnerSignatureSha256,
  adviceOwnerSignatureSha256,
  basicSettingsSignatureSha256,
  basicTextSignatureSha256,
  confirmedCopyOutputSignatureSha256,
  confirmedDetailOutputSignatureSha256,
  confirmedPosterOutputSignatureSha256,
  copyInputIdentityPayload,
  detailArtifactSignatureSha256,
  detailOwnerSignatureSha256,
  domainSeparatedSignatureSha256Sync,
  marketingAdviceInputSignatureSha256,
  posterArtifactSignatureSha256,
  posterCopySnapshotSignatureSha256,
  posterCopySnapshotIdentityPayload,
  posterInputIdentityPayload,
  posterInputSignatureSha256,
  posterProjectIdentitySha256,
  productImageSignatureSha256,
  promotionalCopyArtifactSignatureSha256,
  SIGNATURE_DOMAINS,
} from './workflow-v2-signatures'
import {
  ADVICE_AUTHORITY_VERSION,
  ADVICE_VERSION,
  ASYNC_OWNERSHIP_VERSION,
  BASIC_AUTHORITY_VERSION,
  BASIC_SETTINGS_IDENTITY_VERSION,
  BASIC_TEXT_IDENTITY_VERSION,
  CONFIRMED_COPY_VERSION,
  CONFIRMED_DETAIL_VERSION,
  CONFIRMED_POSTER_VERSION,
  COPY_INPUT_VERSION,
  COPY_REF_VERSION,
  DETAIL_OWNER_VERSION,
  DETAIL_PROJECT_VERSION,
  POSTER_PROJECT_VERSION,
  POSTER_REF_VERSION,
  PRODUCT_IMAGE_IDENTITY_VERSION,
} from './workflow-v2-types'
import type {
  AdviceAuthority,
  AdviceOwner,
  AdviceRequestOutcome,
  AdviceResult,
  AdviceStrategy,
  AsyncResponseOwnershipClaim,
  BasicAuthority,
  BasicTextValues,
  ConfirmedCopy,
  ConfirmedCopyFields,
  ConfirmedDetail,
  ConfirmedPoster,
  CopyInputAuthority,
  CopyRef,
  CopySourceIdentity,
  DetailOwner,
  DetailProject,
  PendingAsyncOwnership,
  PosterCopySnapshot,
  PosterGenerationKind,
  PosterProjectInput,
  PosterRef,
  PosterTypographyMode,
  PresentAdviceAuthority,
  ProductImageIdentity,
} from './workflow-v2-types'
import type { CopyStyleId, PlatformId } from '../../types/platform-copy'
import {
  isPosterStyleTemplateId,
  type PosterStyleTemplateId,
} from '../../types/poster-style-template'

const SHA256 = /^[a-f0-9]{64}$/

function signatureMatches(
  domain: string,
  value: unknown,
  expected: string,
): boolean {
  try {
    return SHA256.test(expected) &&
      domainSeparatedSignatureSha256Sync(domain, value) === expected
  } catch {
    return false
  }
}

function assertSha256(value: string, label: string): void {
  if (!SHA256.test(value)) throw new TypeError(`${label} must be lowercase SHA-256.`)
}

function assertSafeRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`)
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value) throw new TypeError(`${label} must not be empty.`)
}

function cloneAdviceStrategy(strategy: AdviceStrategy): AdviceStrategy {
  return {
    id: strategy.id,
    name: String(strategy.name),
    examples: String(strategy.examples),
    traits: strategy.traits.map(String),
    tactics: strategy.tactics.map(String),
    one_liner: String(strategy.one_liner),
  }
}

function cloneAdviceResult(advice: AdviceResult): AdviceResult {
  if (!Number.isSafeInteger(advice.score) || advice.score < 0) {
    throw new TypeError('Advice score must be a non-negative safe integer.')
  }
  return {
    category_id: advice.category_id,
    category_name: String(advice.category_name),
    confidence: advice.confidence,
    matched_keywords: advice.matched_keywords.map(String),
    reason: String(advice.reason),
    score: advice.score,
    strategy: cloneAdviceStrategy(advice.strategy),
    source: advice.source,
  }
}

function cloneProductImage(image: ProductImageIdentity): ProductImageIdentity {
  return image.kind === 'present'
    ? { ...image }
    : { ...image }
}

export interface BasicAuthorityInput extends BasicTextValues {
  readonly platform: PlatformId
  readonly style: CopyStyleId
  readonly productImage?:
    | Readonly<{
        byteSha256: string
        mimeType: string
        byteSize: number
      }>
    | null
}

export async function createBasicAuthority(
  input: BasicAuthorityInput,
): Promise<BasicAuthority> {
  for (const field of ['productInfo', 'productShortName', 'creativeNote'] as const) {
    if (Array.from(input[field]).length > PRODUCT_INFO_LIMITS[field]) {
      throw new TypeError(`${field} exceeds the existing input limit.`)
    }
  }
  const values = normalizeMarketingAdviceInput(input)
  if (!values.productInfo) {
    throw new TypeError('productInfo must contain non-whitespace characters.')
  }

  const [textSignatureSha256, adviceInputSignatureSha256, settingsSignatureSha256] =
    await Promise.all([
      basicTextSignatureSha256(values),
      marketingAdviceInputSignatureSha256(values),
      basicSettingsSignatureSha256({
        platform: input.platform,
        style: input.style,
      }),
    ])

  let productImage: ProductImageIdentity
  if (input.productImage) {
    assertSha256(input.productImage.byteSha256, 'productImage.byteSha256')
    assertNonEmpty(input.productImage.mimeType, 'productImage.mimeType')
    if (!Number.isSafeInteger(input.productImage.byteSize) || input.productImage.byteSize < 0) {
      throw new TypeError('productImage.byteSize must be a non-negative safe integer.')
    }
    const imageFields = {
      kind: 'present' as const,
      byteSha256: input.productImage.byteSha256,
      mimeType: input.productImage.mimeType,
      byteSize: input.productImage.byteSize,
    }
    productImage = {
      version: PRODUCT_IMAGE_IDENTITY_VERSION,
      ...imageFields,
      signatureSha256: await productImageSignatureSha256(imageFields),
    }
  } else {
    const imageFields = { kind: 'absent' as const }
    productImage = {
      version: PRODUCT_IMAGE_IDENTITY_VERSION,
      ...imageFields,
      signatureSha256: await productImageSignatureSha256(imageFields),
    }
  }

  return {
    version: BASIC_AUTHORITY_VERSION,
    text: {
      version: BASIC_TEXT_IDENTITY_VERSION,
      values,
      signatureSha256: textSignatureSha256,
      adviceInputSignatureSha256,
    },
    settings: {
      version: BASIC_SETTINGS_IDENTITY_VERSION,
      platform: input.platform,
      style: input.style,
      signatureSha256: settingsSignatureSha256,
    },
    productImage,
  }
}

export function isBasicAuthorityInternallyConsistent(
  basic: BasicAuthority,
): boolean {
  if (
    basic.version !== BASIC_AUTHORITY_VERSION ||
    basic.text.version !== BASIC_TEXT_IDENTITY_VERSION ||
    basic.settings.version !== BASIC_SETTINGS_IDENTITY_VERSION ||
    basic.productImage.version !== PRODUCT_IMAGE_IDENTITY_VERSION ||
    canonicalJson(normalizeMarketingAdviceInput(basic.text.values)) !==
      canonicalJson(basic.text.values)
  ) return false
  const advicePayload = {
    product_info: basic.text.values.productInfo,
    product_short_name: basic.text.values.productShortName,
    creative_note: basic.text.values.creativeNote,
  }
  const imagePayload = basic.productImage.kind === 'present'
    ? {
        kind: basic.productImage.kind,
        byteSha256: basic.productImage.byteSha256,
        mimeType: basic.productImage.mimeType,
        byteSize: basic.productImage.byteSize,
      }
    : { kind: basic.productImage.kind }
  return (
    signatureMatches(
      SIGNATURE_DOMAINS.basicText,
      basic.text.values,
      basic.text.signatureSha256,
    ) &&
    signatureMatches(
      SIGNATURE_DOMAINS.adviceInput,
      advicePayload,
      basic.text.adviceInputSignatureSha256,
    ) &&
    signatureMatches(
      SIGNATURE_DOMAINS.basicSettings,
      {
        platform: basic.settings.platform,
        style: basic.settings.style,
      },
      basic.settings.signatureSha256,
    ) &&
    signatureMatches(
      SIGNATURE_DOMAINS.productImage,
      imagePayload,
      basic.productImage.signatureSha256,
    )
  )
}

export interface MarketingAdviceResponseContract {
  readonly api_version: 'v1'
  readonly advice_version: typeof ADVICE_VERSION
  readonly status: 'present'
  readonly input_signature_sha256: string
  readonly advice_signature_sha256: string
  readonly advice: AdviceResult
}

export async function createPresentAdviceAuthority(
  response: MarketingAdviceResponseContract,
  expectedBasic?: BasicAuthority,
): Promise<PresentAdviceAuthority> {
  assertSha256(response.input_signature_sha256, 'input_signature_sha256')
  assertSha256(response.advice_signature_sha256, 'advice_signature_sha256')
  if (
    expectedBasic &&
    response.input_signature_sha256 !==
      expectedBasic.text.adviceInputSignatureSha256
  ) {
    throw new TypeError('Advice response does not own the current Basic text input.')
  }
  const advice = cloneAdviceResult(response.advice)
  const ownerSignatureSha256 = await adviceOwnerSignatureSha256({
    inputSignatureSha256: response.input_signature_sha256,
    adviceSignatureSha256: response.advice_signature_sha256,
    adviceVersion: response.advice_version,
    advice,
  })
  return {
    authorityVersion: ADVICE_AUTHORITY_VERSION,
    kind: 'present',
    adviceVersion: ADVICE_VERSION,
    inputSignatureSha256: response.input_signature_sha256,
    adviceSignatureSha256: response.advice_signature_sha256,
    ownerSignatureSha256,
    advice,
  }
}

export async function createAcknowledgedAbsentAdviceAuthority(
  basic: BasicAuthority,
): Promise<AdviceAuthority> {
  const absentReason = 'user_acknowledged_absence' as const
  return {
    authorityVersion: ADVICE_AUTHORITY_VERSION,
    kind: 'acknowledged_absent',
    adviceVersion: ADVICE_VERSION,
    inputSignatureSha256: basic.text.adviceInputSignatureSha256,
    absentReason,
    ownerSignatureSha256: await absentAdviceOwnerSignatureSha256({
      inputSignatureSha256: basic.text.adviceInputSignatureSha256,
      adviceVersion: ADVICE_VERSION,
      absentReason,
    }),
  }
}

export function adviceAuthorityFromRequestOutcome(
  outcome: AdviceRequestOutcome,
): PresentAdviceAuthority | null {
  return outcome.kind === 'succeeded' ? outcome.authority : null
}

export function adviceOwnerFromAuthority(authority: AdviceAuthority): AdviceOwner {
  return authority.kind === 'present'
    ? {
        kind: authority.kind,
        authorityVersion: authority.authorityVersion,
        adviceVersion: authority.adviceVersion,
        inputSignatureSha256: authority.inputSignatureSha256,
        adviceSignatureSha256: authority.adviceSignatureSha256,
        ownerSignatureSha256: authority.ownerSignatureSha256,
      }
    : {
        kind: authority.kind,
        authorityVersion: authority.authorityVersion,
        adviceVersion: authority.adviceVersion,
        inputSignatureSha256: authority.inputSignatureSha256,
        absentReason: authority.absentReason,
        ownerSignatureSha256: authority.ownerSignatureSha256,
      }
}

export function sameAdviceOwner(
  left: AdviceOwner,
  right: AdviceOwner,
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function isAdviceCurrentForBasic(
  advice: AdviceAuthority,
  basic: BasicAuthority,
): boolean {
  return (
    isBasicAuthorityInternallyConsistent(basic) &&
    isAdviceAuthorityInternallyConsistent(advice) &&
    advice.authorityVersion === ADVICE_AUTHORITY_VERSION &&
    advice.adviceVersion === ADVICE_VERSION &&
    advice.inputSignatureSha256 === basic.text.adviceInputSignatureSha256 &&
    SHA256.test(advice.ownerSignatureSha256) &&
    (advice.kind === 'acknowledged_absent' ||
      SHA256.test(advice.adviceSignatureSha256))
  )
}

export function isAdviceAuthorityInternallyConsistent(
  advice: AdviceAuthority,
): boolean {
  if (
    advice.authorityVersion !== ADVICE_AUTHORITY_VERSION ||
    advice.adviceVersion !== ADVICE_VERSION ||
    !SHA256.test(advice.inputSignatureSha256)
  ) return false
  return advice.kind === 'present'
    ? SHA256.test(advice.adviceSignatureSha256) &&
        signatureMatches(
          SIGNATURE_DOMAINS.adviceOwner,
          {
            inputSignatureSha256: advice.inputSignatureSha256,
            adviceSignatureSha256: advice.adviceSignatureSha256,
            adviceVersion: advice.adviceVersion,
            advice: advice.advice,
          },
          advice.ownerSignatureSha256,
        )
    : signatureMatches(
        SIGNATURE_DOMAINS.adviceAbsentOwner,
        {
          inputSignatureSha256: advice.inputSignatureSha256,
          adviceVersion: advice.adviceVersion,
          absentReason: advice.absentReason,
        },
        advice.ownerSignatureSha256,
      )
}

export async function createCopyInputAuthority(
  basic: BasicAuthority,
  advice: AdviceAuthority,
): Promise<CopyInputAuthority> {
  return createCopyInputAuthoritySync(basic, advice)
}

/**
 * The workspace only needs a pure, immediately available input identity to
 * derive module status. It shares the exact V2 canonical payload and domain
 * with the asynchronous factory used for authority commits.
 */
export function createCopyInputAuthoritySync(
  basic: BasicAuthority,
  advice: AdviceAuthority,
): CopyInputAuthority {
  if (!isAdviceCurrentForBasic(advice, basic)) {
    throw new TypeError('Copy input cannot use stale Advice authority.')
  }
  const partial: Omit<CopyInputAuthority, 'inputSignatureSha256'> = {
    version: COPY_INPUT_VERSION,
    basicOwner: {
      textSignatureSha256: basic.text.signatureSha256,
      settingsSignatureSha256: basic.settings.signatureSha256,
    },
    adviceOwner: adviceOwnerFromAuthority(advice),
    platform: basic.settings.platform,
    style: basic.settings.style,
  }
  return {
    ...partial,
    inputSignatureSha256: domainSeparatedSignatureSha256Sync(
      SIGNATURE_DOMAINS.copyInput,
      copyInputIdentityPayload(partial),
    ),
  }
}

function assertCopySource(source: CopySourceIdentity): void {
  if (source.kind === 'generated') {
    assertSha256(source.requestFingerprintSha256, 'requestFingerprintSha256')
    assertSha256(source.variantSignatureSha256, 'variantSignatureSha256')
    assertSafeRevision(source.selectedVariantIndex, 'selectedVariantIndex')
  } else if (source.kind === 'selected') {
    assertSha256(source.candidateSignatureSha256, 'candidateSignatureSha256')
    assertSafeRevision(source.selectedIndex, 'selectedIndex')
  } else if (source.baseOutputSignatureSha256 !== null) {
    assertSha256(source.baseOutputSignatureSha256, 'baseOutputSignatureSha256')
  }
}

export async function createConfirmedCopy(input: {
  readonly copyInput: CopyInputAuthority
  readonly revision: number
  readonly source: CopySourceIdentity
  readonly fields: ConfirmedCopyFields
}): Promise<ConfirmedCopy> {
  assertSafeRevision(input.revision, 'copy revision')
  assertCopySource(input.source)
  const signatureInput = {
    input: input.copyInput,
    revision: input.revision,
    platform: input.copyInput.platform,
    style: input.copyInput.style,
    source: input.source,
    fields: { ...input.fields },
  }
  const outputSignatureSha256 =
    await confirmedCopyOutputSignatureSha256(signatureInput)
  return {
    authorityVersion: CONFIRMED_COPY_VERSION,
    input: input.copyInput,
    revision: input.revision,
    platform: input.copyInput.platform,
    style: input.copyInput.style,
    source: input.source,
    ...input.fields,
    outputSignatureSha256,
    resultArtifactSignatureSha256:
      await promotionalCopyArtifactSignatureSha256({
        outputSignatureSha256,
        inputSignatureSha256: input.copyInput.inputSignatureSha256,
        revision: input.revision,
      }),
  }
}

export function copyRefFromConfirmedCopy(copy: ConfirmedCopy): CopyRef {
  return {
    version: COPY_REF_VERSION,
    copyAuthorityVersion: copy.authorityVersion,
    revision: copy.revision,
    basicOwner: { ...copy.input.basicOwner },
    adviceOwner: copy.input.adviceOwner,
    inputSignatureSha256: copy.input.inputSignatureSha256,
    outputSignatureSha256: copy.outputSignatureSha256,
  }
}

export function sameCopyRef(
  left: CopyRef | null,
  right: CopyRef | null,
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function confirmedCopyMatchesRef(
  copy: ConfirmedCopy,
  copyRef: CopyRef,
): boolean {
  return sameCopyRef(copyRefFromConfirmedCopy(copy), copyRef)
}

export function isCopyInputInternallyConsistent(
  input: CopyInputAuthority,
): boolean {
  const unsignedInput: Omit<CopyInputAuthority, 'inputSignatureSha256'> = {
    version: input.version,
    basicOwner: input.basicOwner,
    adviceOwner: input.adviceOwner,
    platform: input.platform,
    style: input.style,
  }
  return (
    input.version === COPY_INPUT_VERSION &&
    SHA256.test(input.basicOwner.textSignatureSha256) &&
    SHA256.test(input.basicOwner.settingsSignatureSha256) &&
    SHA256.test(input.adviceOwner.ownerSignatureSha256) &&
    signatureMatches(
      SIGNATURE_DOMAINS.copyInput,
      copyInputIdentityPayload(unsignedInput),
      input.inputSignatureSha256,
    )
  )
}

export function isConfirmedCopyInternallyConsistent(copy: ConfirmedCopy): boolean {
  const outputInput = {
    input: copy.input,
    revision: copy.revision,
    platform: copy.platform,
    style: copy.style,
    source: copy.source,
    fields: {
      body: copy.body,
      title: copy.title,
      headline: copy.headline,
      subline: copy.subline,
    },
  }
  return Boolean(
    copy.authorityVersion === CONFIRMED_COPY_VERSION &&
      isCopyInputInternallyConsistent(copy.input) &&
      copy.platform === copy.input.platform &&
      copy.style === copy.input.style &&
      Number.isSafeInteger(copy.revision) &&
      copy.revision >= 0 &&
      SHA256.test(copy.input.inputSignatureSha256) &&
      signatureMatches(
        SIGNATURE_DOMAINS.confirmedCopyOutput,
        outputInput,
        copy.outputSignatureSha256,
      ) &&
      signatureMatches(
        SIGNATURE_DOMAINS.promotionalCopyArtifact,
        {
          outputSignatureSha256: copy.outputSignatureSha256,
          inputSignatureSha256: copy.input.inputSignatureSha256,
          revision: copy.revision,
        },
        copy.resultArtifactSignatureSha256,
      ),
  )
}

export function sameCopyInput(
  left: CopyInputAuthority,
  right: CopyInputAuthority,
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function isConfirmedCopyCurrent(
  copy: ConfirmedCopy,
  currentInput: CopyInputAuthority,
): boolean {
  return isConfirmedCopyInternallyConsistent(copy) &&
    sameCopyInput(copy.input, currentInput)
}

export async function createPosterProjectInput(input: {
  readonly projectId: string
  readonly basic: BasicAuthority
  readonly advice: AdviceAuthority
  /** Legacy domain fixtures may omit this; production callers always choose. */
  readonly copySource?: 'confirmed_copy' | 'poster_owned'
  readonly copyRef?: CopyRef
  readonly generationKind?: PosterGenerationKind
  readonly typographyMode?: PosterTypographyMode
  readonly styleTemplateId?: PosterStyleTemplateId | null
}): Promise<PosterProjectInput> {
  const projectId = input.projectId.trim()
  assertNonEmpty(projectId, 'projectId')
  if (!isAdviceCurrentForBasic(input.advice, input.basic)) {
    throw new TypeError('Poster input cannot use stale Advice authority.')
  }
  const adviceOwner = adviceOwnerFromAuthority(input.advice)
  const copyRef = input.copyRef ?? null
  const copySource = input.copySource ?? (copyRef ? 'confirmed_copy' : 'poster_owned')
  const requestedTemplateId = input.styleTemplateId ?? null
  if (requestedTemplateId !== null && !isPosterStyleTemplateId(requestedTemplateId)) {
    throw new TypeError('Poster style template is unsupported.')
  }
  const generationKind =
    input.generationKind ??
    (requestedTemplateId !== null ? 'template' : 'blank_base')
  const typographyMode =
    generationKind === 'blank_base'
      ? 'textless'
      : (input.typographyMode ?? 'textless')
  const styleTemplateId =
    generationKind === 'blank_base' ? null : requestedTemplateId
  if (generationKind === 'blank_base' && requestedTemplateId !== null) {
    throw new TypeError('Blank-base poster mode cannot carry a style template.')
  }
  if (generationKind === 'blank_base' && typographyMode !== 'textless') {
    throw new TypeError('Blank-base poster mode must remain textless.')
  }
  if (
    (copySource === 'confirmed_copy' && !copyRef) ||
    (copySource === 'poster_owned' && copyRef)
  ) {
    throw new TypeError('Poster source mode and CopyRef must agree.')
  }
  if (
    copyRef &&
    (copyRef.basicOwner.textSignatureSha256 !==
      input.basic.text.signatureSha256 ||
      copyRef.basicOwner.settingsSignatureSha256 !==
        input.basic.settings.signatureSha256 ||
      !sameAdviceOwner(copyRef.adviceOwner, adviceOwner))
  ) {
    throw new TypeError('Poster CopyRef has a mixed Basic or Advice owner.')
  }
  const partial: Omit<PosterProjectInput, 'inputSignatureSha256'> = {
    version: POSTER_PROJECT_VERSION,
    projectId,
    projectIdentitySha256: await posterProjectIdentitySha256(projectId),
    basicOwner: {
      textSignatureSha256: input.basic.text.signatureSha256,
      settingsSignatureSha256: input.basic.settings.signatureSha256,
      productImage: cloneProductImage(input.basic.productImage),
    },
    adviceOwner,
    platform: input.basic.settings.platform,
    style: input.basic.settings.style,
    copySource,
    copyRef,
    generationKind,
    typographyMode,
    styleTemplateId,
  }
  return {
    ...partial,
    inputSignatureSha256: await posterInputSignatureSha256(partial),
  }
}

export async function createPosterCopySnapshot(input: {
  readonly fields: ConfirmedCopyFields
  readonly platform: PlatformId
  readonly style: CopyStyleId
  readonly sourceMode?: 'confirmed_copy' | 'poster_owned'
  readonly sourceCopyRef?: CopyRef
}): Promise<PosterCopySnapshot> {
  const sourceMode = input.sourceMode ?? (input.sourceCopyRef ? 'confirmed_copy' : 'poster_owned')
  if (
    (sourceMode === 'confirmed_copy' && !input.sourceCopyRef) ||
    (sourceMode === 'poster_owned' && input.sourceCopyRef)
  ) {
    throw new TypeError('Poster copy snapshot source does not match its CopyRef.')
  }
  const partial: Omit<PosterCopySnapshot, 'snapshotSignatureSha256'> = {
    kind: 'poster_copy_snapshot',
    ...input.fields,
    platform: input.platform,
    style: input.style,
    sourceMode,
    sourceCopyRef: input.sourceCopyRef ?? null,
  }
  return {
    ...partial,
    snapshotSignatureSha256:
      await posterCopySnapshotSignatureSha256(partial),
  }
}

export async function createConfirmedPoster(input: {
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
  readonly copySnapshot: PosterCopySnapshot
}): Promise<ConfirmedPoster> {
  assertNonEmpty(input.generationId, 'generationId')
  assertNonEmpty(input.posterId, 'posterId')
  if (!Number.isSafeInteger(input.slot) || input.slot < 1) {
    throw new TypeError('slot must be a positive safe integer.')
  }
  for (const [label, value] of [
    ['baseBlobSha256', input.baseBlobSha256],
    ['layoutSha256', input.layoutSha256],
    ['upstreamSha256', input.upstreamSha256],
    ['compositionInputSignatureSha256', input.compositionInputSignatureSha256],
    ['pngBlobSha256', input.pngBlobSha256],
    ['snapshotSignatureSha256', input.copySnapshot.snapshotSignatureSha256],
  ] as const) assertSha256(value, label)
  assertSafeRevision(input.confirmedRevision, 'confirmedRevision')
  assertSafeRevision(input.resourceRevision, 'resourceRevision')
  if (
    input.project.copySource !== input.copySnapshot.sourceMode ||
    !sameCopyRef(input.project.copyRef, input.copySnapshot.sourceCopyRef)
  ) {
    throw new TypeError('Poster copy snapshot does not match the explicit CopyRef.')
  }
  if (
    input.copySnapshot.platform !== input.project.platform ||
    input.copySnapshot.style !== input.project.style
  ) {
    throw new TypeError('Poster copy snapshot has a mixed settings owner.')
  }
  const signatureInput = {
    project: input.project,
    generationId: input.generationId,
    posterId: input.posterId,
    slot: input.slot,
    baseBlobSha256: input.baseBlobSha256,
    layoutSha256: input.layoutSha256,
    upstreamSha256: input.upstreamSha256,
    compositionInputSignatureSha256: input.compositionInputSignatureSha256,
    pngBlobSha256: input.pngBlobSha256,
    confirmedRevision: input.confirmedRevision,
    resourceRevision: input.resourceRevision,
    copySnapshotSignatureSha256: input.copySnapshot.snapshotSignatureSha256,
  }
  const outputSignatureSha256 =
    await confirmedPosterOutputSignatureSha256(signatureInput)
  return {
    authorityVersion: CONFIRMED_POSTER_VERSION,
    ...input,
    outputSignatureSha256,
    resultArtifactSignatureSha256: await posterArtifactSignatureSha256({
      outputSignatureSha256,
      projectIdentitySha256: input.project.projectIdentitySha256,
      confirmedRevision: input.confirmedRevision,
      pngBlobSha256: input.pngBlobSha256,
    }),
  }
}

export function posterRefFromConfirmedPoster(poster: ConfirmedPoster): PosterRef {
  return {
    version: POSTER_REF_VERSION,
    posterAuthorityVersion: poster.authorityVersion,
    projectId: poster.project.projectId,
    projectIdentitySha256: poster.project.projectIdentitySha256,
    posterInputSignatureSha256: poster.project.inputSignatureSha256,
    generationId: poster.generationId,
    posterId: poster.posterId,
    slot: poster.slot,
    baseBlobSha256: poster.baseBlobSha256,
    layoutSha256: poster.layoutSha256,
    upstreamSha256: poster.upstreamSha256,
    compositionInputSignatureSha256: poster.compositionInputSignatureSha256,
    pngBlobSha256: poster.pngBlobSha256,
    confirmedRevision: poster.confirmedRevision,
    resourceRevision: poster.resourceRevision,
    outputSignatureSha256: poster.outputSignatureSha256,
  }
}

/** Reject partial or mixed Poster references before they can own Detail. */
export function isPosterRefInternallyConsistent(ref: PosterRef): boolean {
  return Boolean(
    ref.version === POSTER_REF_VERSION &&
      ref.posterAuthorityVersion === CONFIRMED_POSTER_VERSION &&
      ref.projectId &&
      ref.generationId &&
      ref.posterId &&
      Number.isSafeInteger(ref.slot) && ref.slot >= 1 &&
      Number.isSafeInteger(ref.confirmedRevision) && ref.confirmedRevision >= 0 &&
      Number.isSafeInteger(ref.resourceRevision) && ref.resourceRevision >= 0 &&
      [
        ref.projectIdentitySha256,
        ref.posterInputSignatureSha256,
        ref.baseBlobSha256,
        ref.layoutSha256,
        ref.upstreamSha256,
        ref.compositionInputSignatureSha256,
        ref.pngBlobSha256,
        ref.outputSignatureSha256,
      ].every((value) => SHA256.test(value)),
  )
}

export function samePosterRef(
  left: PosterRef | null,
  right: PosterRef | null,
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function confirmedPosterMatchesRef(
  poster: ConfirmedPoster,
  posterRef: PosterRef,
): boolean {
  return samePosterRef(posterRefFromConfirmedPoster(poster), posterRef)
}

export function sameProductImageIdentity(
  left: ProductImageIdentity,
  right: ProductImageIdentity,
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function isProductImageIdentityInternallyConsistent(
  image: ProductImageIdentity,
): boolean {
  const payload = image.kind === 'present'
    ? {
        kind: image.kind,
        byteSha256: image.byteSha256,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
      }
    : { kind: image.kind }
  return image.version === PRODUCT_IMAGE_IDENTITY_VERSION &&
    (image.kind === 'absent' || (
      SHA256.test(image.byteSha256) &&
      Boolean(image.mimeType) &&
      Number.isSafeInteger(image.byteSize) &&
      image.byteSize >= 0
    )) &&
    signatureMatches(
      SIGNATURE_DOMAINS.productImage,
      payload,
      image.signatureSha256,
    )
}

function isCopyRefInternallyConsistent(copyRef: CopyRef): boolean {
  return Boolean(
    copyRef.version === COPY_REF_VERSION &&
      copyRef.copyAuthorityVersion === CONFIRMED_COPY_VERSION &&
      Number.isSafeInteger(copyRef.revision) &&
      copyRef.revision >= 0 &&
      SHA256.test(copyRef.basicOwner.textSignatureSha256) &&
      SHA256.test(copyRef.basicOwner.settingsSignatureSha256) &&
      SHA256.test(copyRef.adviceOwner.ownerSignatureSha256) &&
      SHA256.test(copyRef.inputSignatureSha256) &&
      SHA256.test(copyRef.outputSignatureSha256),
  )
}

export function isPosterProjectInternallyConsistent(
  project: PosterProjectInput,
): boolean {
  const unsignedProject: Omit<PosterProjectInput, 'inputSignatureSha256'> = {
    version: project.version,
    projectId: project.projectId,
    projectIdentitySha256: project.projectIdentitySha256,
    basicOwner: project.basicOwner,
    adviceOwner: project.adviceOwner,
    platform: project.platform,
    style: project.style,
    copySource: project.copySource,
    copyRef: project.copyRef,
    generationKind: project.generationKind,
    typographyMode: project.typographyMode,
    styleTemplateId: project.styleTemplateId,
  }
  if (
    project.version !== POSTER_PROJECT_VERSION ||
    !project.projectId ||
    !signatureMatches(
      SIGNATURE_DOMAINS.posterProject,
      { projectId: project.projectId },
      project.projectIdentitySha256,
    ) ||
    !signatureMatches(
      SIGNATURE_DOMAINS.posterInput,
      posterInputIdentityPayload(unsignedProject),
      project.inputSignatureSha256,
    ) ||
    !isProductImageIdentityInternallyConsistent(
      project.basicOwner.productImage,
    ) ||
    !SHA256.test(project.basicOwner.textSignatureSha256) ||
    !SHA256.test(project.basicOwner.settingsSignatureSha256) ||
    !SHA256.test(project.adviceOwner.ownerSignatureSha256) ||
    project.platform === undefined ||
    project.style === undefined ||
    (project.generationKind !== 'blank_base' &&
      project.generationKind !== 'template') ||
    (project.typographyMode !== 'textless' &&
      project.typographyMode !== 'with_text') ||
    (project.generationKind === 'blank_base' &&
      (project.styleTemplateId !== null ||
        project.typographyMode !== 'textless')) ||
    (project.styleTemplateId !== null &&
      !isPosterStyleTemplateId(project.styleTemplateId))
  ) return false
  return !project.copyRef || (
    isCopyRefInternallyConsistent(project.copyRef) &&
    project.copyRef.basicOwner.textSignatureSha256 ===
      project.basicOwner.textSignatureSha256 &&
    project.copyRef.basicOwner.settingsSignatureSha256 ===
      project.basicOwner.settingsSignatureSha256 &&
    sameAdviceOwner(project.copyRef.adviceOwner, project.adviceOwner)
  )
}

export function isPosterProjectCurrent(
  project: PosterProjectInput,
  basic: BasicAuthority,
  advice: AdviceAuthority,
  currentCopy: ConfirmedCopy | null,
): boolean {
  if (!isPosterProjectInternallyConsistent(project)) return false
  if (!isAdviceCurrentForBasic(advice, basic)) return false
  if (
    project.basicOwner.textSignatureSha256 !== basic.text.signatureSha256 ||
    project.basicOwner.settingsSignatureSha256 !==
      basic.settings.signatureSha256 ||
    !sameProductImageIdentity(
      project.basicOwner.productImage,
      basic.productImage,
    ) ||
    project.platform !== basic.settings.platform ||
    project.style !== basic.settings.style ||
    !sameAdviceOwner(project.adviceOwner, adviceOwnerFromAuthority(advice)) ||
    (project.copySource === 'confirmed_copy' && !project.copyRef) ||
    (project.copySource === 'poster_owned' && project.copyRef)
  ) return false
  if (!project.copyRef) return true
  return Boolean(
    currentCopy &&
      isConfirmedCopyInternallyConsistent(currentCopy) &&
      currentCopy.input.basicOwner.textSignatureSha256 ===
        basic.text.signatureSha256 &&
      currentCopy.input.basicOwner.settingsSignatureSha256 ===
        basic.settings.signatureSha256 &&
      currentCopy.platform === basic.settings.platform &&
      currentCopy.style === basic.settings.style &&
      sameAdviceOwner(
        currentCopy.input.adviceOwner,
        adviceOwnerFromAuthority(advice),
      ) &&
      confirmedCopyMatchesRef(currentCopy, project.copyRef),
  )
}

export function isConfirmedPosterInternallyConsistent(
  poster: ConfirmedPoster,
): boolean {
  const snapshotInput: Omit<PosterCopySnapshot, 'snapshotSignatureSha256'> = {
    kind: poster.copySnapshot.kind,
    body: poster.copySnapshot.body,
    title: poster.copySnapshot.title,
    headline: poster.copySnapshot.headline,
    subline: poster.copySnapshot.subline,
    sourceMode: poster.copySnapshot.sourceMode,
    platform: poster.copySnapshot.platform,
    style: poster.copySnapshot.style,
    sourceCopyRef: poster.copySnapshot.sourceCopyRef,
  }
  const outputInput = {
    project: poster.project,
    generationId: poster.generationId,
    posterId: poster.posterId,
    slot: poster.slot,
    baseBlobSha256: poster.baseBlobSha256,
    layoutSha256: poster.layoutSha256,
    upstreamSha256: poster.upstreamSha256,
    compositionInputSignatureSha256:
      poster.compositionInputSignatureSha256,
    pngBlobSha256: poster.pngBlobSha256,
    confirmedRevision: poster.confirmedRevision,
    resourceRevision: poster.resourceRevision,
    copySnapshotSignatureSha256:
      poster.copySnapshot.snapshotSignatureSha256,
  }
  return Boolean(
    poster.authorityVersion === CONFIRMED_POSTER_VERSION &&
      isPosterProjectInternallyConsistent(poster.project) &&
      poster.generationId &&
      poster.posterId &&
      Number.isSafeInteger(poster.slot) &&
      poster.slot >= 1 &&
      Number.isSafeInteger(poster.confirmedRevision) &&
      poster.confirmedRevision >= 0 &&
      Number.isSafeInteger(poster.resourceRevision) &&
      poster.resourceRevision >= 0 &&
      poster.copySnapshot.platform === poster.project.platform &&
      poster.copySnapshot.style === poster.project.style &&
      poster.copySnapshot.sourceMode === poster.project.copySource &&
      sameCopyRef(
        poster.copySnapshot.sourceCopyRef,
        poster.project.copyRef,
      ) &&
      SHA256.test(poster.baseBlobSha256) &&
      SHA256.test(poster.layoutSha256) &&
      SHA256.test(poster.upstreamSha256) &&
      SHA256.test(poster.compositionInputSignatureSha256) &&
      SHA256.test(poster.pngBlobSha256) &&
      signatureMatches(
        SIGNATURE_DOMAINS.posterCopySnapshot,
        posterCopySnapshotIdentityPayload(snapshotInput),
        poster.copySnapshot.snapshotSignatureSha256,
      ) &&
      signatureMatches(
        SIGNATURE_DOMAINS.confirmedPosterOutput,
        outputInput,
        poster.outputSignatureSha256,
      ) &&
      signatureMatches(
        SIGNATURE_DOMAINS.posterArtifact,
        {
          outputSignatureSha256: poster.outputSignatureSha256,
          projectIdentitySha256: poster.project.projectIdentitySha256,
          confirmedRevision: poster.confirmedRevision,
          pngBlobSha256: poster.pngBlobSha256,
        },
        poster.resultArtifactSignatureSha256,
      ),
  )
}

export function isConfirmedPosterCurrent(
  poster: ConfirmedPoster,
  basic: BasicAuthority,
  advice: AdviceAuthority,
  currentCopy: ConfirmedCopy | null,
): boolean {
  return isConfirmedPosterInternallyConsistent(poster) &&
    isPosterProjectCurrent(poster.project, basic, advice, currentCopy)
}

export async function createDetailOwner(
  posterRef: PosterRef,
): Promise<DetailOwner> {
  const partial: Omit<DetailOwner, 'ownerSignatureSha256'> = {
    version: DETAIL_OWNER_VERSION,
    posterRef,
  }
  return {
    ...partial,
    ownerSignatureSha256: await detailOwnerSignatureSha256(partial),
  }
}

export function isDetailOwnerInternallyConsistent(owner: DetailOwner): boolean {
  return Boolean(
    owner.version === DETAIL_OWNER_VERSION &&
      isPosterRefInternallyConsistent(owner.posterRef) &&
      signatureMatches(
        SIGNATURE_DOMAINS.detailOwner,
        { version: owner.version, posterRef: owner.posterRef },
        owner.ownerSignatureSha256,
      ),
  )
}

export function isDetailProjectInternallyConsistent(
  project: DetailProject,
): boolean {
  return Boolean(
    project.version === DETAIL_PROJECT_VERSION &&
      project.detailId &&
      isDetailOwnerInternallyConsistent(project.owner) &&
      project.projectSignatureSha256 === project.owner.ownerSignatureSha256,
  )
}

export async function createConfirmedDetail(input: {
  readonly detailId: string
  readonly posterRef: PosterRef
  readonly detailRevision: number
  readonly resourceRevision: number
  readonly pageSignatureSha256: readonly string[]
  readonly pngBlobSha256: readonly string[]
  readonly groupSignatureSha256: string
}): Promise<ConfirmedDetail> {
  assertNonEmpty(input.detailId, 'detailId')
  assertSafeRevision(input.detailRevision, 'detailRevision')
  assertSafeRevision(input.resourceRevision, 'resourceRevision')
  if (
    input.pageSignatureSha256.length === 0 ||
    input.pageSignatureSha256.length !== input.pngBlobSha256.length
  ) {
    throw new TypeError('Detail page and PNG identities must be non-empty and aligned.')
  }
  for (const value of [
    ...input.pageSignatureSha256,
    ...input.pngBlobSha256,
    input.groupSignatureSha256,
  ]) assertSha256(value, 'detail signature')
  const owner = await createDetailOwner(input.posterRef)
  const signatureInput = {
    detailId: input.detailId,
    owner,
    detailRevision: input.detailRevision,
    resourceRevision: input.resourceRevision,
    pageSignatureSha256: [...input.pageSignatureSha256],
    pngBlobSha256: [...input.pngBlobSha256],
    groupSignatureSha256: input.groupSignatureSha256,
  }
  const outputSignatureSha256 =
    await confirmedDetailOutputSignatureSha256(signatureInput)
  return {
    authorityVersion: CONFIRMED_DETAIL_VERSION,
    ...signatureInput,
    outputSignatureSha256,
    resultArtifactSignatureSha256: await detailArtifactSignatureSha256({
      outputSignatureSha256,
      posterOutputSignatureSha256: input.posterRef.outputSignatureSha256,
      detailRevision: input.detailRevision,
    }),
  }
}

export function isConfirmedDetailInternallyConsistent(
  detail: ConfirmedDetail,
): boolean {
  const outputInput = {
    detailId: detail.detailId,
    owner: detail.owner,
    detailRevision: detail.detailRevision,
    resourceRevision: detail.resourceRevision,
    pageSignatureSha256: detail.pageSignatureSha256,
    pngBlobSha256: detail.pngBlobSha256,
    groupSignatureSha256: detail.groupSignatureSha256,
  }
  return Boolean(
    detail.authorityVersion === CONFIRMED_DETAIL_VERSION &&
      isDetailOwnerInternallyConsistent(detail.owner) &&
      detail.detailId &&
      detail.pageSignatureSha256.length > 0 &&
      detail.pageSignatureSha256.length === detail.pngBlobSha256.length &&
      Number.isSafeInteger(detail.detailRevision) &&
      detail.detailRevision >= 0 &&
      Number.isSafeInteger(detail.resourceRevision) &&
      detail.resourceRevision >= 0 &&
      signatureMatches(
        SIGNATURE_DOMAINS.detailOwner,
        {
          version: detail.owner.version,
          posterRef: detail.owner.posterRef,
        },
        detail.owner.ownerSignatureSha256,
      ) &&
      detail.pageSignatureSha256.every((value) => SHA256.test(value)) &&
      detail.pngBlobSha256.every((value) => SHA256.test(value)) &&
      SHA256.test(detail.groupSignatureSha256) &&
      signatureMatches(
        SIGNATURE_DOMAINS.confirmedDetailOutput,
        outputInput,
        detail.outputSignatureSha256,
      ) &&
      signatureMatches(
        SIGNATURE_DOMAINS.detailArtifact,
        {
          outputSignatureSha256: detail.outputSignatureSha256,
          posterOutputSignatureSha256:
            detail.owner.posterRef.outputSignatureSha256,
          detailRevision: detail.detailRevision,
        },
        detail.resultArtifactSignatureSha256,
      ),
  )
}

function sameAsyncOwnership(
  left: PendingAsyncOwnership | AsyncResponseOwnershipClaim,
  right: PendingAsyncOwnership | AsyncResponseOwnershipClaim,
): boolean {
  return (
    left.module === right.module &&
    left.workflowEpoch === right.workflowEpoch &&
    left.requestId === right.requestId &&
    left.pendingFingerprintSha256 === right.pendingFingerprintSha256 &&
    left.ownerInputSignatureSha256 === right.ownerInputSignatureSha256 &&
    left.revision === right.revision &&
    left.referenceSignatureSha256 === right.referenceSignatureSha256
  )
}

export function canAcceptAsyncResponse(
  captured: PendingAsyncOwnership,
  current: PendingAsyncOwnership | null,
  response: AsyncResponseOwnershipClaim,
): boolean {
  return Boolean(
    current &&
      captured.version === ASYNC_OWNERSHIP_VERSION &&
      current.version === ASYNC_OWNERSHIP_VERSION &&
      sameAsyncOwnership(captured, current) &&
      sameAsyncOwnership(current, response),
  )
}

export function canAcceptAdviceResponse(
  captured: PendingAsyncOwnership,
  current: PendingAsyncOwnership | null,
  response: AsyncResponseOwnershipClaim,
): boolean {
  return captured.module === 'advice' &&
    response.module === 'advice' &&
    canAcceptAsyncResponse(captured, current, response)
}

export function canAcceptCopyResponse(
  captured: PendingAsyncOwnership,
  current: PendingAsyncOwnership | null,
  response: AsyncResponseOwnershipClaim,
): boolean {
  return captured.module === 'copy' &&
    response.module === 'copy' &&
    canAcceptAsyncResponse(captured, current, response)
}

export function canAcceptPosterResponse(
  captured: PendingAsyncOwnership,
  current: PendingAsyncOwnership | null,
  response: AsyncResponseOwnershipClaim,
): boolean {
  return captured.module === 'poster' &&
    response.module === 'poster' &&
    canAcceptAsyncResponse(captured, current, response)
}

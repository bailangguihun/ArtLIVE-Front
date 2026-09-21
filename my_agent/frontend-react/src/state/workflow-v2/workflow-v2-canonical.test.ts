import { describe, expect, expectTypeOf, it } from 'vitest'
import { createInitialWorkflowState, workflowReducer } from '../workflow-reducer'
import { WORKFLOW_STEPS } from '../workflow-types'
import type { WorkflowAction } from '../workflow-types'
import {
  canonicalJson,
  normalizeMarketingAdviceInput,
  pythonUnicodeStrip,
} from './workflow-v2-canonical'
import { createBasicAuthority } from './workflow-v2-authorities'
import { marketingAdviceInputSignatureSha256 } from './workflow-v2-signatures'
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
  POSTER_PROJECT_VERSION,
  POSTER_REF_VERSION,
  PRODUCT_IMAGE_IDENTITY_VERSION,
  PROGRESSIVE_RESULTS_VERSION,
  WORKFLOW_V2_CONTRACT_VERSION,
  WORKFLOW_V2_MODULE_IDS,
  WORKFLOW_V2_MODULE_STATUSES,
  WORKFLOW_V2_OPERATION_PHASES,
  WORKFLOW_V2_STATUS_REASON_CODES,
  WORKFLOW_V2_VIEW_IDS,
} from './workflow-v2-types'

const hash = (character: string) => character.repeat(64)

const LEGACY_ACTION_TYPES = [
  'UPDATE_STEP_ONE_FIELD',
  'REPLACE_STEP_ONE_IMAGE',
  'REMOVE_STEP_ONE_IMAGE',
  'VALIDATE_STEP_ONE',
  'COMPLETE_STEP_ONE',
  'GO_TO_STEP_ONE',
  'UPDATE_STEP_TWO_PLATFORM',
  'UPDATE_STEP_TWO_STYLE',
  'UPDATE_STEP_TWO_DRAFT',
  'SELECT_STEP_TWO_VARIANT',
  'SET_COPY_GENERATION_ERROR',
  'BEGIN_COPY_GENERATION',
  'COPY_GENERATION_SUCCEEDED',
  'COPY_GENERATION_FAILED',
  'END_COPY_GENERATION',
  'COMPLETE_STEP_TWO',
  'GO_TO_STEP_TWO',
  'SET_POSTER_CONSENT',
  'BEGIN_POSTER_CAPABILITIES',
  'POSTER_CAPABILITIES_SUCCEEDED',
  'POSTER_CAPABILITIES_FAILED',
  'SET_POSTER_ADMISSION_ERROR',
  'BEGIN_POSTER_ADMISSION',
  'SET_PENDING_POSTER_INTENT',
  'POSTER_ADMISSION_FAILED',
  'END_POSTER_ADMISSION',
  'APPLY_POSTER_RESULT',
  'SET_POSTER_POLL_ERROR',
  'SELECT_POSTER_SLOT',
  'COMPLETE_STEP_THREE',
  'BEGIN_POSTER_BINARY',
  'POSTER_BINARY_SUCCEEDED',
  'POSTER_BINARY_FAILED',
  'RESET_POSTER_BINARY',
  'BEGIN_POSTER_ZIP',
  'POSTER_ZIP_SUCCEEDED',
  'POSTER_ZIP_FAILED',
  'BEGIN_STEP_FOUR_ENTRY',
  'CANCEL_STEP_FOUR_ENTRY',
  'STEP_FOUR_ENTRY_FAILED',
  'ENTER_STEP_FOUR',
  'GO_TO_STEP_THREE',
  'SET_STEP_FOUR_UI',
  'COMMIT_STEP_FOUR_MUTATION',
  'BEGIN_STEP_FOUR_EXPORT',
  'STEP_FOUR_EXPORT_FINISHED',
  'STEP_FOUR_EXPORT_FAILED',
  'BEGIN_STEP_FOUR_CONFIRMATION',
  'STEP_FOUR_CONFIRMATION_SUCCEEDED',
  'STEP_FOUR_CONFIRMATION_FAILED',
  'COMPLETE_STEP_FOUR',
  'GO_TO_STEP_FOUR',
  'SET_STEP_FIVE_UI',
  'SET_STEP_FIVE_ACTIVE_PAGE',
  'ADD_STEP_FIVE_PAGE',
  'COMMIT_STEP_FIVE_PAGE_MUTATION',
  'BEGIN_STEP_FIVE_PIXEL_MUTATION',
  'COMMIT_STEP_FIVE_PIXEL_MUTATION',
  'SET_STEP_FIVE_OPERATIONS',
  'STEP_FIVE_EXPORT_SUCCEEDED',
  'STEP_FIVE_CONFIRMATION_SUCCEEDED',
  'COMPLETE_STEP_FIVE',
  'GO_TO_STEP_FIVE',
  'COMPLETE_STEP_SIX',
  'GO_TO_STEP_SIX',
  'RESET_WORKFLOW',
] as const satisfies readonly WorkflowAction['type'][]

type MissingLegacyAction = Exclude<
  Extract<WorkflowAction['type'], (typeof LEGACY_ACTION_TYPES)[number]>,
  (typeof LEGACY_ACTION_TYPES)[number]
>

describe('Workflow V2 versions and strict canonicalization', () => {
  it('exposes the complete stable view, module, status, reason, and version vocabulary', () => {
    expect(WORKFLOW_V2_VIEW_IDS).toEqual([
      'home', 'history', 'basic', 'advice', 'workspace', 'copy', 'poster', 'detail', 'results',
    ])
    expect(WORKFLOW_V2_MODULE_IDS).toEqual(['copy', 'poster', 'detail'])
    expect(WORKFLOW_V2_MODULE_STATUSES).toEqual([
      'locked', 'ready', 'in_progress', 'completed', 'stale', 'failed',
    ])
    expect(WORKFLOW_V2_OPERATION_PHASES).toEqual([
      'advice_request',
      'copy_request',
      'poster_admission',
      'poster_generation',
      'poster_polling',
      'poster_download',
      'poster_editing',
      'poster_export',
      'poster_confirmation',
      'detail_editing',
      'detail_export',
      'detail_confirmation',
    ])
    expect(WORKFLOW_V2_STATUS_REASON_CODES).toEqual(expect.arrayContaining([
      'basic_missing', 'basic_stale', 'advice_missing', 'advice_stale',
      'product_image_missing', 'capability_unavailable', 'request_in_progress',
      'output_current', 'output_stale', 'owner_mismatch',
      'copy_reference_stale', 'poster_not_confirmed',
      'poster_reference_stale', 'operation_failed',
    ]))
    expect([
      WORKFLOW_V2_CONTRACT_VERSION,
      BASIC_AUTHORITY_VERSION,
      BASIC_TEXT_IDENTITY_VERSION,
      BASIC_SETTINGS_IDENTITY_VERSION,
      PRODUCT_IMAGE_IDENTITY_VERSION,
      ADVICE_AUTHORITY_VERSION,
      ADVICE_VERSION,
      COPY_INPUT_VERSION,
      CONFIRMED_COPY_VERSION,
      COPY_REF_VERSION,
      POSTER_PROJECT_VERSION,
      CONFIRMED_POSTER_VERSION,
      POSTER_REF_VERSION,
      DETAIL_OWNER_VERSION,
      CONFIRMED_DETAIL_VERSION,
      PROGRESSIVE_RESULTS_VERSION,
      ASYNC_OWNERSHIP_VERSION,
    ]).toEqual([
      'workflow-v2-contract-v1',
      'workflow-v2-basic-v1',
      'workflow-v2-basic-text-v1',
      'workflow-v2-basic-settings-v1',
      'workflow-v2-product-image-v1',
      'workflow-v2-advice-authority-v1',
      'catalog-v1',
      'workflow-v2-copy-input-v1',
      'workflow-v2-confirmed-copy-v1',
      'workflow-v2-copy-ref-v1',
      'workflow-v2-poster-project-v3',
      'workflow-v2-confirmed-poster-v1',
      'workflow-v2-poster-ref-v1',
      'workflow-v2-detail-owner-v1',
      'workflow-v2-confirmed-detail-v1',
      'workflow-v2-progressive-results-v1',
      'workflow-v2-async-ownership-v1',
    ])
  })

  it('sorts object keys recursively, preserves array order, and emits compact Unicode JSON', () => {
    const first = canonicalJson({ z: [3, { y: '衣服👕', x: 1 }], a: true })
    const reordered = canonicalJson({ a: true, z: [3, { x: 1, y: '衣服👕' }] })
    expect(first).toBe(reordered)
    expect(first).toBe('{"a":true,"z":[3,{"x":1,"y":"衣服👕"}]}')
    expect(first).not.toContain('\\u')
    expect(canonicalJson({ items: ['a', 'b'] })).not.toBe(
      canonicalJson({ items: ['b', 'a'] }),
    )
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}')
  })

  it('rejects non-finite, unsupported, cyclic, and non-scalar values', () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/)
    expect(() => canonicalJson({ value: Infinity })).toThrow(/non-finite/)
    expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/)
    expect(() => canonicalJson(new Date())).toThrow(/plain objects/)
    expect(() => canonicalJson('\ud800')).toThrow(/unpaired/)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/)
  })
})

describe('dormant compatibility with the current seven-step workflow', () => {
  it('keeps the exact 66-action union, seven labels, initial shape, and reset contract', () => {
    expect(LEGACY_ACTION_TYPES).toHaveLength(66)
    expect(new Set(LEGACY_ACTION_TYPES).size).toBe(66)
    expectTypeOf<MissingLegacyAction>().toEqualTypeOf<never>()
    expect(WORKFLOW_STEPS.map((step) => step.label)).toEqual([
      '1. 产品信息',
      '2. 平台与文案',
      '3. 生成海报',
      '4. 文字编辑',
      '5. 详情页制作',
      '6. 营销策略',
      '7. 最终结果',
    ])
    const initial = createInitialWorkflowState()
    expect(initial.currentStep).toBe(1)
    expect(initial.completedSteps.size).toBe(0)
    expect(Object.keys(initial)).toEqual([
      'currentStep',
      'completedSteps',
      'productInfo',
      'platformCopy',
      'posterGeneration',
      'posterEditor',
      'detailEditor',
      'marketingStrategyStep',
      'workflowV2',
    ])
    expect(workflowReducer(initial, { type: 'RESET_WORKFLOW' })).toEqual(
      createInitialWorkflowState(),
    )
  })
})

describe('Round 1 compatible Advice input normalization and signatures', () => {
  it('mirrors Python str.strip rather than JavaScript trim', () => {
    expect(pythonUnicodeStrip('\u3000\t API\r\n\u00a0')).toBe('API')
    expect(pythonUnicodeStrip('\u001cAPI\u0085')).toBe('API')
    expect(pythonUnicodeStrip('\ufeff API \ufeff')).toBe('\ufeff API \ufeff')
    expect('\ufeff API \ufeff'.trim()).toBe('API')
  })

  it('preserves internal whitespace, LF, CRLF, Unicode composition, and emoji', () => {
    expect(normalizeMarketingAdviceInput({
      productInfo: '\t API 工具\r\n专业版 \n',
      productShortName: '  云端套件  ',
      creativeNote: '\r\n首行\r\n  次行\t ',
    })).toEqual({
      productInfo: 'API 工具\r\n专业版',
      productShortName: '云端套件',
      creativeNote: '首行\r\n  次行',
    })
    expect(normalizeMarketingAdviceInput({
      productInfo: ' Café 👕 ', productShortName: '', creativeNote: 'a  b',
    })).toEqual({
      productInfo: 'Café 👕', productShortName: '', creativeNote: 'a  b',
    })
  })

  it('matches the Round 1 Unicode and CRLF/LF golden vectors byte for byte', async () => {
    await expect(marketingAdviceInputSignatureSha256({
      productInfo: '\u3000山茶花洗衣液，守护柔软👕\u3000',
      productShortName: '\u00a0柔护衣\u00a0',
      creativeNote: '  轻盈香氛 · 夏日限定  ',
    })).resolves.toBe(
      '1f263ed9cb0d06b73bf4d1e12382406f0483682630a2ee470ca0ac4948decbc3',
    )
    await expect(marketingAdviceInputSignatureSha256({
      productInfo: '\t  API 工具\r\n专业版  \n',
      productShortName: '  云端套件  ',
      creativeNote: '\r\n首行\r\n  次行\t ',
    })).resolves.toBe(
      '26769b8f29c3d147476cb86d7e180df4717c4cde46f60235fef0ba117f46a849',
    )
    await expect(marketingAdviceInputSignatureSha256({
      productInfo: 'API 工具\n专业版',
      productShortName: '云端套件',
      creativeNote: '首行\n  次行',
    })).resolves.toBe(
      'bc6dbb26520803da8f98e1f70a2746caf9668e260471c3f916af0483176a1d14',
    )
    const composed = await marketingAdviceInputSignatureSha256({
      productInfo: 'Café API', productShortName: '', creativeNote: '',
    })
    const decomposed = await marketingAdviceInputSignatureSha256({
      productInfo: 'Cafe\u0301 API', productShortName: '', creativeNote: '',
    })
    expect(composed).not.toBe(decomposed)
  })

  it('changes when each consumed field changes and stays stable for equal normalized input', async () => {
    const base = { productInfo: 'API suite', productShortName: 'Cloud', creativeNote: 'Launch' }
    const signature = await marketingAdviceInputSignatureSha256(base)
    await expect(marketingAdviceInputSignatureSha256({ ...base, productInfo: 'API suite 2' })).resolves.not.toBe(signature)
    await expect(marketingAdviceInputSignatureSha256({ ...base, productShortName: 'Cloud 2' })).resolves.not.toBe(signature)
    await expect(marketingAdviceInputSignatureSha256({ ...base, creativeNote: 'Launch 2' })).resolves.not.toBe(signature)
    await expect(marketingAdviceInputSignatureSha256({ ...base, productInfo: '\u3000API suite\r\n' })).resolves.toBe(signature)
  })
})

describe('field-scoped Basic authority', () => {
  it('keeps text, settings, and image identities independent', async () => {
    const base = await createBasicAuthority({
      productInfo: 'API suite', productShortName: 'Cloud', creativeNote: 'Launch',
      platform: 'xiaohongshu', style: 'premium',
      productImage: { byteSha256: hash('a'), mimeType: 'image/png', byteSize: 7 },
    })
    const textChanged = await createBasicAuthority({
      productInfo: 'API suite 2', productShortName: 'Cloud', creativeNote: 'Launch',
      platform: 'xiaohongshu', style: 'premium',
      productImage: { byteSha256: hash('a'), mimeType: 'image/png', byteSize: 7 },
    })
    const settingsChanged = await createBasicAuthority({
      productInfo: 'API suite', productShortName: 'Cloud', creativeNote: 'Launch',
      platform: 'douyin', style: 'premium',
      productImage: { byteSha256: hash('a'), mimeType: 'image/png', byteSize: 7 },
    })
    const imageChanged = await createBasicAuthority({
      productInfo: 'API suite', productShortName: 'Cloud', creativeNote: 'Launch',
      platform: 'xiaohongshu', style: 'premium',
      productImage: { byteSha256: hash('b'), mimeType: 'image/png', byteSize: 7 },
    })
    expect(textChanged.text.signatureSha256).not.toBe(base.text.signatureSha256)
    expect(textChanged.settings.signatureSha256).toBe(base.settings.signatureSha256)
    expect(textChanged.productImage.signatureSha256).toBe(base.productImage.signatureSha256)
    expect(settingsChanged.text.signatureSha256).toBe(base.text.signatureSha256)
    expect(settingsChanged.settings.signatureSha256).not.toBe(base.settings.signatureSha256)
    expect(settingsChanged.productImage.signatureSha256).toBe(base.productImage.signatureSha256)
    expect(imageChanged.text.signatureSha256).toBe(base.text.signatureSha256)
    expect(imageChanged.settings.signatureSha256).toBe(base.settings.signatureSha256)
    expect(imageChanged.productImage.signatureSha256).not.toBe(base.productImage.signatureSha256)
  })

  it('uses byte authority and explicit absence without filename or object URL identity', async () => {
    const present = await createBasicAuthority({
      productInfo: 'Bag', productShortName: '', creativeNote: '',
      platform: 'taobao', style: 'vibrant',
      productImage: { byteSha256: hash('c'), mimeType: 'image/webp', byteSize: 12 },
    })
    const absent = await createBasicAuthority({
      productInfo: 'Bag', productShortName: '', creativeNote: '',
      platform: 'taobao', style: 'vibrant', productImage: null,
    })
    expect(present.productImage).toMatchObject({
      kind: 'present', byteSha256: hash('c'), mimeType: 'image/webp', byteSize: 12,
    })
    expect(canonicalJson(present.productImage)).not.toMatch(/filename|objectUrl|previewUrl|blob/i)
    expect(absent.productImage).toMatchObject({ kind: 'absent' })
  })
})

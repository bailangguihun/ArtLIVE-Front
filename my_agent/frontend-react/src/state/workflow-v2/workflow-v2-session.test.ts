import { describe, expect, it } from 'vitest'
import { createActiveWorkflowV2Session, bumpBasicDraftRevision, createInitialWorkflowV2Session } from './workflow-v2-session'
import { createInitialWorkflowState, workflowReducer } from '../workflow-reducer'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createCopyInputAuthority,
  createPresentAdviceAuthority,
} from './workflow-v2-authorities'
import {
  domainSeparatedSignatureSha256,
  marketingAdviceInputSignatureSha256,
} from './workflow-v2-signatures'
import type { AdviceResult } from './workflow-v2-types'

const TEST_ADVICE: AdviceResult = {
  category_id: 'fmcg',
  category_name: '快消品',
  confidence: 'low',
  matched_keywords: [],
  reason: '测试回退。',
  score: 0,
  strategy: {
    id: 'fmcg',
    name: '测试策略',
    examples: '测试方向。',
    traits: ['清晰'],
    tactics: ['说明价值'],
    one_liner: '测试。',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function ownedAdvice() {
  const basic = await createBasicAuthority({
    productInfo: '测试商品',
    productShortName: '',
    creativeNote: '',
    platform: 'xiaohongshu',
    style: 'premium',
    productImage: null,
  })
  const [input_signature_sha256, advice_signature_sha256] = await Promise.all([
    marketingAdviceInputSignatureSha256(basic.text.values),
    domainSeparatedSignatureSha256('marketing-advice-output-v1', TEST_ADVICE),
  ])
  return {
    basic,
    advice: await createPresentAdviceAuthority({
      api_version: 'v1',
      advice_version: 'catalog-v1',
      status: 'present',
      input_signature_sha256,
      advice_signature_sha256,
      advice: TEST_ADVICE,
    }, basic),
  }
}

describe('Workflow V2 session ownership', () => {
  it('starts in Home, increments epochs, and rejects stale basic commits', () => {
    const initial = createInitialWorkflowState()
    expect(initial.workflowV2.phase).toBe('none')
    const first = workflowReducer(initial, { type: 'START_V2_CREATION' })
    expect(first.workflowV2.epoch).toBe(1)
    const pending = { requestId: 'a', workflowEpoch: 1, draftRevision: first.workflowV2.basicDraftRevision }
    const withPending = workflowReducer(first, { type: 'BEGIN_V2_BASIC_COMMIT', pending })
    const changed = workflowReducer(withPending, { type: 'UPDATE_STEP_ONE_FIELD', field: 'productInfo', value: '新商品' })
    expect(changed.workflowV2.pendingBasicCommit).toBeNull()
    const late = workflowReducer(changed, { type: 'FAIL_V2_BASIC_COMMIT', ...pending, error: 'late' })
    expect(late.workflowV2.basicCommitError).toBe('')
    const second = workflowReducer(late, { type: 'START_V2_CREATION' })
    expect(second.workflowV2.epoch).toBe(2)
  })

  it('tracks draft revision without storing a derived module status', () => {
    const session = createActiveWorkflowV2Session(4)
    expect(bumpBasicDraftRevision(session).basicDraftRevision).toBe(1)
    expect(createInitialWorkflowV2Session().view).toBe('home')
  })

  it('fails closed for old request IDs, owners, and epochs before Advice can commit', async () => {
    const { basic, advice } = await ownedAdvice()
    const started = workflowReducer(createInitialWorkflowState(), {
      type: 'START_V2_CREATION',
    })
    const basicPending = {
      requestId: 'basic',
      workflowEpoch: started.workflowV2.epoch,
      draftRevision: started.workflowV2.basicDraftRevision,
    }
    const withBasicPending = workflowReducer(started, {
      type: 'BEGIN_V2_BASIC_COMMIT',
      pending: basicPending,
    })
    const committedBasic = workflowReducer(withBasicPending, {
      type: 'COMMIT_V2_BASIC',
      ...basicPending,
      authority: basic,
    })
    const advicePending = {
      requestId: 'advice-a',
      workflowEpoch: committedBasic.workflowV2.epoch,
      draftRevision: committedBasic.workflowV2.basicDraftRevision,
      expectedInputSignatureSha256: basic.text.adviceInputSignatureSha256,
      basicTextSignatureSha256: basic.text.signatureSha256,
    }
    const pending = workflowReducer(committedBasic, {
      type: 'BEGIN_V2_ADVICE_REQUEST',
      pending: advicePending,
    })
    const wrongRequest = workflowReducer(pending, {
      type: 'COMMIT_V2_ADVICE',
      ...advicePending,
      requestId: 'advice-b',
      authority: advice,
    })
    expect(wrongRequest).toBe(pending)

    const wrongOwner = workflowReducer(pending, {
      type: 'COMMIT_V2_ADVICE',
      ...advicePending,
      expectedInputSignatureSha256: '0'.repeat(64),
      authority: advice,
    })
    expect(wrongOwner).toBe(pending)

    const reset = workflowReducer(pending, { type: 'START_V2_CREATION' })
    const oldEpoch = workflowReducer(reset, {
      type: 'COMMIT_V2_ADVICE',
      ...advicePending,
      authority: advice,
    })
    expect(oldEpoch).toBe(reset)
    expect(oldEpoch.workflowV2.adviceAuthority).toBeNull()
  })

  it('keeps Results derived through Home Continue and fails closed to Workspace after the current result disappears', async () => {
    const { basic, advice } = await ownedAdvice()
    const copy = await createConfirmedCopy({
      copyInput: await createCopyInputAuthority(basic, advice),
      revision: 1,
      source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: 'c'.repeat(64) },
      fields: { body: '当前文案', title: '标题', headline: '主标题', subline: '副标题' },
    })
    const active = {
      ...createInitialWorkflowState(),
      workflowV2: {
        ...createActiveWorkflowV2Session(1),
        view: 'workspace' as const,
        resumeView: 'workspace' as const,
        basicAuthority: basic,
        adviceAuthority: advice,
        confirmedCopy: copy,
      },
    }
    const results = workflowReducer(active, { type: 'ENTER_V2_RESULTS' })
    expect(results.workflowV2.view).toBe('results')
    expect(results.workflowV2.confirmedCopy).toBe(copy)
    const home = workflowReducer(results, { type: 'V2_RETURN_HOME' })
    expect(home.workflowV2.resumeView).toBe('results')
    expect(workflowReducer(home, { type: 'V2_CONTINUE_SESSION' }).workflowV2.view).toBe('results')

    const staleHome = {
      ...home,
      workflowV2: { ...home.workflowV2, confirmedCopy: null },
    }
    const fallback = workflowReducer(staleHome, { type: 'V2_CONTINUE_SESSION' })
    expect(fallback.workflowV2.view).toBe('workspace')
    expect(fallback.workflowV2.workspaceFocusModule).toBe('results')

    const reset = workflowReducer(results, { type: 'START_V2_CREATION' })
    expect(reset.workflowV2.epoch).toBe(2)
    expect(reset.workflowV2.confirmedCopy).toBeNull()
    expect(reset.workflowV2.view).toBe('workflow')
  })
})

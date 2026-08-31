import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import {
  createCopyInputAuthoritySync,
  isAdviceCurrentForBasic,
  posterRefFromConfirmedPoster,
} from '../../state/workflow-v2/workflow-v2-authorities'
import {
  selectCopyModuleStatus,
  selectDetailModuleStatus,
  selectPosterModuleStatus,
} from '../../state/workflow-v2/workflow-v2-selectors'
import { selectCurrentProgressiveResultsView } from '../progressive-results/progressive-results-model'
import type {
  ModuleOperationState,
  WorkflowV2ModuleStatusResult,
} from '../../state/workflow-v2/workflow-v2-types'
import {
  useWorkflowDetailCommands,
  useWorkflowDispatch,
  useWorkflowState,
} from '../../state/use-workflow'

const STATUS_LABEL: Record<WorkflowV2ModuleStatusResult['status'], string> = {
  locked: '暂不可用',
  ready: '可开始',
  in_progress: '进行中',
  completed: '已完成',
  stale: '需要更新',
  failed: '生成失败',
}

const STATUS_REASON: Record<WorkflowV2ModuleStatusResult['reasonCode'], string> = {
  basic_missing: '请先完成本轮基本信息。',
  basic_stale: '基本信息已更新，请重新确认。',
  advice_missing: '请先获得当前营销建议。',
  advice_stale: '营销建议属于较早的商品信息。',
  product_image_missing: '海报创作需要当前商品图片。',
  capability_unavailable: '现有海报能力暂不可用。',
  request_in_progress: '当前请求仍在进行中。',
  output_current: '已与本轮创作依据保持一致。',
  output_stale: '保留了可恢复的较早结果，请更新。',
  owner_mismatch: '当前结果的创作依据不一致。',
  copy_reference_stale: '请先确认适用于本轮的宣传文案。',
  poster_not_confirmed: '请先在现有海报流程确认海报。',
  poster_reference_stale: '关联海报已更新，请先处理海报。',
  operation_failed: '最近一次生成未完成，可显式重试。',
  inputs_current: '已具备当前创作所需信息。',
}

function idleOperation(): ModuleOperationState {
  return { kind: 'idle' }
}

function copyOperation(
  state: ReturnType<typeof useWorkflowState>,
  inputSignature: string | null,
): ModuleOperationState {
  const pending = state.workflowV2.pendingCopyRequest
  if (pending && inputSignature === pending.expectedCopyInputSignatureSha256) {
    return {
      kind: 'in_progress',
      phase: 'copy_request',
      ownerInputSignatureSha256: pending.expectedCopyInputSignatureSha256,
    }
  }
  const failure = state.workflowV2.copyRequestFailure
  if (failure && inputSignature === failure.ownerInputSignatureSha256) {
    return {
      kind: 'failed',
      phase: 'copy_request',
      ownerInputSignatureSha256: failure.ownerInputSignatureSha256,
      errorCode: failure.error,
    }
  }
  return idleOperation()
}

function detailOperation(
  state: ReturnType<typeof useWorkflowState>,
): ModuleOperationState {
  const poster = state.workflowV2.confirmedPoster
  if (!poster) return idleOperation()
  const owner = posterRefFromConfirmedPoster(poster).outputSignatureSha256
  const operations = state.detailEditor.operations
  if (
    operations.exportBusy ||
    operations.confirmationBusy ||
    operations.imageBusy
  ) {
    return {
      kind: 'in_progress',
      phase: operations.imageBusy ? 'detail_editing' : operations.exportBusy
        ? 'detail_export'
        : 'detail_confirmation',
      ownerInputSignatureSha256: owner,
    }
  }
  if (operations.exportError || operations.confirmationError) {
    return {
      kind: 'failed',
      phase: operations.exportError ? 'detail_export' : 'detail_confirmation',
      ownerInputSignatureSha256: owner,
      errorCode: 'detail_operation_failed',
    }
  }
  return idleOperation()
}

function moduleAction(status: WorkflowV2ModuleStatusResult): string {
  if (status.status === 'completed') return '查看宣传文案'
  if (status.status === 'stale') return '更新宣传文案'
  if (status.status === 'in_progress') return '继续编辑宣传文案'
  return '进入宣传文案'
}

interface WorkspaceModuleProps {
  id: 'copy' | 'poster' | 'detail'
  title: string
  description: string
  status: WorkflowV2ModuleStatusResult
  action: string
  disabled: boolean
  onEnter: () => void
  actionRef?: RefObject<HTMLButtonElement | null>
  reasonRef?: RefObject<HTMLParagraphElement | null>
  allowLockedActivation?: boolean
}

function WorkspaceModule({
  id,
  title,
  description,
  status,
  action,
  disabled,
  onEnter,
  actionRef,
  reasonRef,
  allowLockedActivation = false,
}: WorkspaceModuleProps) {
  return (
    <section
      aria-labelledby={`workspace-${id}-heading`}
      className="creation-workspace-module"
      data-status={status.status}
    >
      <div className="creation-workspace-module__title">
        <h2 id={`workspace-${id}-heading`}>{title}</h2>
        <p aria-label={`状态：${STATUS_LABEL[status.status]}`} className="creation-workspace-module__status">
          {STATUS_LABEL[status.status]}
        </p>
      </div>
      <p className="creation-workspace-module__description">{description}</p>
      <p
        className="creation-workspace-module__reason"
        ref={reasonRef}
        tabIndex={status.status === 'locked' ? -1 : undefined}
      >
        {status.reasonCode === 'poster_not_confirmed'
          ? '请先确认一张当前海报，再开始详情页编辑。'
          : STATUS_REASON[status.reasonCode]}
      </p>
      <button
        aria-disabled={disabled || undefined}
        className="creation-workspace-module__action"
        disabled={disabled && !allowLockedActivation}
        onClick={() => {
          if (disabled) {
            reasonRef?.current?.focus()
            return
          }
          onEnter()
        }}
        ref={actionRef}
        type="button"
      >
        {action}
      </button>
    </section>
  )
}

export function CreationWorkspace() {
  const state = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const { enterDetail } = useWorkflowDetailCommands()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const copyActionRef = useRef<HTMLButtonElement>(null)
  const posterActionRef = useRef<HTMLButtonElement>(null)
  const detailActionRef = useRef<HTMLButtonElement>(null)
  const detailReasonRef = useRef<HTMLParagraphElement>(null)
  const resultsActionRef = useRef<HTMLButtonElement>(null)
  const resultsReasonRef = useRef<HTMLParagraphElement>(null)
  const initialFocusAppliedRef = useRef(false)
  const { basicAuthority: basic, adviceAuthority: advice } = state.workflowV2
  const currentAdvice = Boolean(basic && advice && isAdviceCurrentForBasic(advice, basic))
  const copyInput = useMemo(() => {
    if (!basic || !advice || !currentAdvice) return null
    return createCopyInputAuthoritySync(basic, advice)
  }, [advice, basic, currentAdvice])
  const copyStatus = selectCopyModuleStatus({
    basic,
    advice,
    input: copyInput,
    confirmedCopy: state.workflowV2.confirmedCopy,
    recoverableDraftInputSignatureSha256:
      state.workflowV2.generatedCopyInputSignatureSha256,
    operation: copyOperation(state, copyInput?.inputSignatureSha256 ?? null),
  })
  const selectorPosterStatus = selectPosterModuleStatus({
    basic,
    advice,
    project: state.workflowV2.posterProject,
    currentCopy: state.workflowV2.confirmedCopy,
    confirmedPoster: state.workflowV2.confirmedPoster,
    currentPosterRef: state.workflowV2.confirmedPoster
      ? posterRefFromConfirmedPoster(state.workflowV2.confirmedPoster)
      : null,
    operation: idleOperation(),
    capabilityAvailable: state.posterGeneration.capabilities.sequenceEnabled !== false,
  })
  const posterStatus: WorkflowV2ModuleStatusResult = selectorPosterStatus
  const detailStatus = selectDetailModuleStatus({
    currentPoster: posterStatus.status === 'completed'
      ? state.workflowV2.confirmedPoster
      : null,
    confirmedDetail: state.workflowV2.confirmedDetail,
    currentDetailOutputSignatureSha256:
      state.workflowV2.currentDetailOutputSignatureSha256,
    recoverableDraftPosterRef:
      state.workflowV2.detailProject?.owner.posterRef ?? null,
    operation: detailOperation(state),
  })
  const canEnterCopy = currentAdvice && copyStatus.status !== 'locked'
  const canEnterPoster =
    posterStatus.status !== 'locked' &&
    posterStatus.status !== 'in_progress' &&
    basic?.productImage.kind === 'present'
  const results = useMemo(() => selectCurrentProgressiveResultsView(state), [state])
  const resultKinds = [
    results.selection.promotionalCopy ? '推广文案' : null,
    results.poster ? '海报设计' : null,
    results.details.length > 0 ? '详情页' : null,
  ].filter((item): item is string => item !== null)

  useEffect(() => {
    if (state.workflowV2.workspaceFocusModule === 'copy') {
      initialFocusAppliedRef.current = true
      copyActionRef.current?.focus()
      dispatch({ type: 'CLEAR_V2_WORKSPACE_FOCUS' })
      return
    }
    if (state.workflowV2.workspaceFocusModule === 'poster') {
      initialFocusAppliedRef.current = true
      posterActionRef.current?.focus()
      dispatch({ type: 'CLEAR_V2_WORKSPACE_FOCUS' })
      return
    }
    if (state.workflowV2.workspaceFocusModule === 'detail') {
      initialFocusAppliedRef.current = true
      detailActionRef.current?.focus()
      dispatch({ type: 'CLEAR_V2_WORKSPACE_FOCUS' })
      return
    }
    if (state.workflowV2.workspaceFocusModule === 'results') {
      initialFocusAppliedRef.current = true
      if (results.selection.mode === 'none') resultsReasonRef.current?.focus()
      else resultsActionRef.current?.focus()
      dispatch({ type: 'CLEAR_V2_WORKSPACE_FOCUS' })
      return
    }
    if (!initialFocusAppliedRef.current) {
      initialFocusAppliedRef.current = true
      headingRef.current?.focus()
    }
  }, [dispatch, results.selection.mode, state.workflowV2.workspaceFocusModule])

  if (!basic || !advice || !currentAdvice) return null

  return (
    <section aria-labelledby="creation-workspace-heading" className="creation-workspace">
      <header className="creation-workspace__intro">
        <h1 id="creation-workspace-heading" ref={headingRef} tabIndex={-1}>创作工作台</h1>
        <p>选择要完成的创作模块，并查看本轮内容的当前状态。</p>
        <button
          className="text-action creation-workspace__back"
          onClick={() => dispatch({ type: 'RETURN_TO_V2_ADVICE' })}
          type="button"
        >
          返回营销建议
        </button>
      </header>

      <div className="creation-workspace__modules">
        <WorkspaceModule
          action={moduleAction(copyStatus)}
          actionRef={copyActionRef}
          description="生成、编辑并确认适用于当前平台与风格的宣传文案。"
          disabled={!canEnterCopy}
          id="copy"
          onEnter={() => dispatch({ type: 'ENTER_V2_COPY' })}
          status={copyStatus}
          title="宣传文案"
        />
        <WorkspaceModule
          action={posterStatus.status === 'completed' ? '查看海报创作' : '进入海报创作'}
          actionRef={posterActionRef}
          description="根据商品信息、营销方向与已确认文案进入海报创作流程。"
          disabled={!canEnterPoster}
          id="poster"
          onEnter={() => dispatch({ type: 'ENTER_V2_POSTER' })}
          status={posterStatus}
          title="海报创作"
        />
        <WorkspaceModule
          action="进入详情页编辑"
          description="确认海报后，继续完成详情页内容编辑。"
          actionRef={detailActionRef}
          allowLockedActivation
          disabled={detailStatus.status === 'locked'}
          id="detail"
          onEnter={enterDetail}
          reasonRef={detailReasonRef}
          status={detailStatus}
          title="详情页编辑"
        />
      </div>
      <section aria-labelledby="workspace-results-heading" className="creation-workspace-results">
        <div className="creation-workspace-results__title">
          <div>
            <p className="creation-workspace-results__eyebrow">RESULTS</p>
            <h2 id="workspace-results-heading">创作成果</h2>
          </div>
          <p className="creation-workspace-results__status">
            {results.selection.mode === 'none'
              ? '暂不可用'
              : results.selection.mode === 'all_current'
                ? '全部当前成果'
                : '部分当前成果'}
          </p>
        </div>
        <p className="creation-workspace-results__description">
          {results.selection.mode === 'none'
            ? '确认至少一项当前创作输出后，可在这里查看成果。'
            : `已收集 ${results.artifactCount} 项成果：${resultKinds.join('、')}。`}
        </p>
        <p className="creation-workspace-results__reason" ref={resultsReasonRef} tabIndex={-1}>
          {results.selection.mode === 'none'
            ? '当前没有可安全展示的确认成果；较早或不匹配的结果不会被当作当前成果。'
            : '成果只包含当前已确认且内部校验通过的输出。'}
        </p>
        <button
          aria-disabled={results.selection.mode === 'none' || undefined}
          className="creation-workspace-results__action"
          onClick={() => {
            if (results.selection.mode === 'none') {
              resultsReasonRef.current?.focus()
              return
            }
            dispatch({ type: 'ENTER_V2_RESULTS' })
          }}
          ref={resultsActionRef}
          type="button"
        >
          查看创作成果
        </button>
      </section>
    </section>
  )
}

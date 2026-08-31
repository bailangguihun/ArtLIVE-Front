import { useWorkflowState } from '../state/use-workflow'
import type { WorkflowState } from '../state/workflow-types'

const WORKFLOW_V2_STAGES = [
  { id: 1, number: '01', label: '基本信息' },
  { id: 2, number: '02', label: '营销建议' },
  { id: 3, number: '03', label: '创作工作台' },
] as const

function workflowStageForState(
  state: Pick<WorkflowState, 'currentStep' | 'workflowV2'>,
): (typeof WORKFLOW_V2_STAGES)[number]['id'] {
  if (state.workflowV2.phase === 'active') {
    switch (state.workflowV2.view) {
      case 'workflow':
        return 1
      case 'advice':
        return 2
      case 'workspace':
      case 'copy':
      case 'poster':
      case 'detail':
      case 'results':
        return 3
      case 'home':
        return 1
    }
  }

  // The legacy compatibility workflow keeps its original reducer step IDs.
  // It is presented through the same three-stage, V2-oriented shell rather
  // than exposing the retired seven-item rail.
  if (state.currentStep <= 1) return 1
  if (state.currentStep === 2) return 2
  return 3
}

export function WorkflowRail() {
  const state = useWorkflowState()
  const currentStage = workflowStageForState(state)

  return (
    <nav aria-label="Workflow V2 进度" className="workflow-rail">
      <ol className="workflow-rail__track">
        {WORKFLOW_V2_STAGES.map((stage) => {
          const isActive = currentStage === stage.id
          const isComplete = stage.id < currentStage
          const state = isActive
            ? 'active'
            : isComplete
              ? 'complete'
              : 'future'

          return (
            <li
              aria-label={`${stage.number} ${stage.label}`}
              aria-current={isActive ? 'step' : undefined}
              className={`workflow-rail__item workflow-rail__item--${state}`}
              key={stage.id}
            >
              <span className="workflow-rail__number">{stage.number}</span>
              <span className="workflow-rail__label">{stage.label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

import { useContext } from 'react'
import {
  WorkflowAdviceCommandsContext,
  WorkflowCopyCommandsContext,
  WorkflowDetailCommandsContext,
  WorkflowDispatchContext,
  WorkflowStateContext,
} from './workflow-context'

export function useWorkflowState() {
  const context = useContext(WorkflowStateContext)
  if (!context) {
    throw new Error('useWorkflowState must be used inside WorkflowProvider')
  }
  return context
}

export function useWorkflowDispatch() {
  const context = useContext(WorkflowDispatchContext)
  if (!context) {
    throw new Error('useWorkflowDispatch must be used inside WorkflowProvider')
  }
  return context
}

export function useWorkflowAdviceCommands() {
  const context = useContext(WorkflowAdviceCommandsContext)
  if (!context) {
    throw new Error('useWorkflowAdviceCommands must be used inside WorkflowProvider')
  }
  return context
}

export function useWorkflowCopyCommands() {
  const context = useContext(WorkflowCopyCommandsContext)
  if (!context) {
    throw new Error('useWorkflowCopyCommands must be used inside WorkflowProvider')
  }
  return context
}

export function useWorkflowDetailCommands() {
  const context = useContext(WorkflowDetailCommandsContext)
  if (!context) {
    throw new Error('useWorkflowDetailCommands must be used inside WorkflowProvider')
  }
  return context
}

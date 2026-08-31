import { createContext } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowAction, WorkflowState } from './workflow-types'
import type { BasicAuthority } from './workflow-v2/workflow-v2-types'

export interface WorkflowAdviceCommands {
  requestAdvice(input: {
    readonly authority: BasicAuthority
    readonly workflowEpoch: number
    readonly draftRevision: number
  }): void
  retryAdvice(): void
}

export interface WorkflowCopyCommands {
  requestCopy(options?: { readonly force?: boolean }): void
  retryCopy(): void
  confirmCopy(): void
  cancelCopy(): void
}

/** Lifecycle-owned Detail admission; reducers keep only serializable authority. */
export interface WorkflowDetailCommands {
  enterDetail(): void
  startNewDetailProject(): void
}

export const WorkflowStateContext = createContext<WorkflowState | undefined>(
  undefined,
)

export const WorkflowDispatchContext = createContext<
  Dispatch<WorkflowAction> | undefined
>(undefined)

export const WorkflowAdviceCommandsContext = createContext<
  WorkflowAdviceCommands | undefined
>(undefined)

export const WorkflowCopyCommandsContext = createContext<
  WorkflowCopyCommands | undefined
>(undefined)

export const WorkflowDetailCommandsContext = createContext<
  WorkflowDetailCommands | undefined
>(undefined)

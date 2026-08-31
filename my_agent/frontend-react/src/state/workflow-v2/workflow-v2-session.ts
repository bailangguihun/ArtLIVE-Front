import type {
  BasicAuthority,
  ConfirmedCopy,
  ConfirmedDetail,
  ConfirmedPoster,
  DetailProject,
  PresentAdviceAuthority,
  PosterProjectInput,
} from './workflow-v2-types'

export type WorkflowV2ShellView =
  | 'home'
  | 'history'
  | 'workflow'
  | 'advice'
  | 'workspace'
  | 'copy'
  | 'poster'
  | 'detail'
  | 'results'
export type WorkflowV2ResumableView = Exclude<WorkflowV2ShellView, 'home'>

export interface PendingBasicCommit {
  readonly requestId: string
  readonly workflowEpoch: number
  readonly draftRevision: number
}

/** Transport ownership only; AbortController remains in WorkflowProvider. */
export interface PendingAdviceRequest {
  readonly requestId: string
  readonly workflowEpoch: number
  readonly draftRevision: number
  readonly expectedInputSignatureSha256: string
  readonly basicTextSignatureSha256: string
}

/** Transport ownership only; AbortController remains in WorkflowProvider. */
export interface PendingCopyRequest {
  readonly requestId: string
  readonly workflowEpoch: number
  readonly basicDraftRevision: number
  readonly copyDraftRevision: number
  readonly basicTextSignatureSha256: string
  readonly basicSettingsSignatureSha256: string
  readonly adviceInputSignatureSha256: string
  readonly adviceSignatureSha256: string
  readonly expectedCopyInputSignatureSha256: string
  readonly fingerprintSha256: string
  readonly idempotencyKey: string
}

export type AdviceRequestErrorCode =
  | 'validation'
  | 'network_server'
  | 'protocol'

export type CopyRequestErrorCode =
  | 'network_server'
  | 'protocol'
  | 'aborted'

export interface CopyRequestFailure {
  readonly ownerInputSignatureSha256: string
  readonly error: CopyRequestErrorCode
}

/**
 * The V2 session is deliberately structural: `phase` is the source of truth
 * for whether a same-tab creation exists, while `view` only describes where
 * that session is being presented. It is not a second current-step model.
 */
export interface WorkflowV2SessionState {
  readonly phase: 'none' | 'active'
  readonly view: WorkflowV2ShellView
  readonly resumeView: WorkflowV2ResumableView
  readonly epoch: number
  readonly basicAuthority: BasicAuthority | null
  /** A stale result is deliberately retained for recovery, never treated as current. */
  readonly adviceAuthority: PresentAdviceAuthority | null
  readonly basicDraftRevision: number
  readonly pendingBasicCommit: PendingBasicCommit | null
  readonly basicCommitError: string
  readonly pendingAdviceRequest: PendingAdviceRequest | null
  readonly adviceRequestError: AdviceRequestErrorCode | null
  /** A stale authority stays recoverable, but is never selected as current. */
  readonly confirmedCopy: ConfirmedCopy | null
  readonly copyDraftRevision: number
  readonly pendingCopyRequest: PendingCopyRequest | null
  readonly copyRequestFailure: CopyRequestFailure | null
  /** The input owner of the currently displayed generated candidates. */
  readonly generatedCopyInputSignatureSha256: string | null
  /** A navigation affordance, not a semantic module state. */
  readonly posterProject: PosterProjectInput | null
  /** A stale Poster stays recoverable; selectors decide whether it is current. */
  readonly confirmedPoster: ConfirmedPoster | null
  readonly posterProjectRevision: number
  /** The current V2 adapter project; legacy Detail state is its renderer only. */
  readonly detailProject: DetailProject | null
  /** Retained on Poster replacement for recoverable stale Detail output. */
  readonly confirmedDetail: ConfirmedDetail | null
  readonly currentDetailOutputSignatureSha256: string | null
  readonly detailEntryError: string
  readonly workspaceFocusModule: 'copy' | 'poster' | 'detail' | 'results' | null
}

export function createInitialWorkflowV2Session(): WorkflowV2SessionState {
  return {
    phase: 'none',
    view: 'home',
    resumeView: 'workflow',
    epoch: 0,
    basicAuthority: null,
    adviceAuthority: null,
    basicDraftRevision: 0,
    pendingBasicCommit: null,
    basicCommitError: '',
    pendingAdviceRequest: null,
    adviceRequestError: null,
    confirmedCopy: null,
    copyDraftRevision: 0,
    pendingCopyRequest: null,
    copyRequestFailure: null,
    generatedCopyInputSignatureSha256: null,
    posterProject: null,
    confirmedPoster: null,
    posterProjectRevision: 0,
    detailProject: null,
    confirmedDetail: null,
    currentDetailOutputSignatureSha256: null,
    detailEntryError: '',
    workspaceFocusModule: null,
  }
}

export function createActiveWorkflowV2Session(
  epoch: number,
): WorkflowV2SessionState {
  return {
    phase: 'active',
    view: 'workflow',
    resumeView: 'workflow',
    epoch,
    basicAuthority: null,
    adviceAuthority: null,
    basicDraftRevision: 0,
    pendingBasicCommit: null,
    basicCommitError: '',
    pendingAdviceRequest: null,
    adviceRequestError: null,
    confirmedCopy: null,
    copyDraftRevision: 0,
    pendingCopyRequest: null,
    copyRequestFailure: null,
    generatedCopyInputSignatureSha256: null,
    posterProject: null,
    confirmedPoster: null,
    posterProjectRevision: 0,
    detailProject: null,
    confirmedDetail: null,
    currentDetailOutputSignatureSha256: null,
    detailEntryError: '',
    workspaceFocusModule: null,
  }
}

export function bumpBasicDraftRevision(
  session: WorkflowV2SessionState,
): WorkflowV2SessionState {
  if (session.phase !== 'active') return session
  return {
    ...session,
    basicDraftRevision: session.basicDraftRevision + 1,
    pendingBasicCommit: null,
    basicCommitError: '',
    pendingAdviceRequest: null,
    adviceRequestError: null,
    pendingCopyRequest: null,
    copyRequestFailure: null,
    workspaceFocusModule: null,
  }
}

export function bumpCopyDraftRevision(
  session: WorkflowV2SessionState,
): WorkflowV2SessionState {
  if (session.phase !== 'active') return session
  return {
    ...session,
    copyDraftRevision: session.copyDraftRevision + 1,
    workspaceFocusModule: null,
  }
}

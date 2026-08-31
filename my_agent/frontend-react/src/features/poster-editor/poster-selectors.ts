import { isCurrentStepFourConfirmation } from '../../state/workflow-reducer'
import type { PosterEditorState } from '../../types/poster-editor'

export function selectCurrentConfirmedPoster(editor: PosterEditorState) {
  return isCurrentStepFourConfirmation(editor) ? editor.confirmedPoster : null
}

export function selectCurrentConfirmedPosterBlob(editor: PosterEditorState) {
  return selectCurrentConfirmedPoster(editor)?.pngBlob ?? null
}

export function selectCurrentStepFourCompletion(editor: PosterEditorState) {
  const confirmed = selectCurrentConfirmedPoster(editor)
  const completion = editor.completion
  if (
    !confirmed ||
    !completion ||
    completion.generationId !== confirmed.generationId ||
    completion.posterId !== confirmed.posterId ||
    completion.confirmedRevision !== confirmed.confirmedRevision ||
    completion.baseBlobSha256 !== confirmed.baseBlobSha256 ||
    completion.layoutSha256 !== confirmed.layoutSha256 ||
    completion.upstreamSha256 !== confirmed.upstreamSha256 ||
    completion.pngBlobSha256 !== confirmed.pngBlobSha256
  ) return null
  return completion
}

import type {
  NormalizedSequenceResult,
  PosterCapabilitiesState,
} from '../../types/poster-generation'
import {
  overallStatusMessages,
  PROVIDER_CONSENT_TEXT,
} from './poster-status-copy'

interface PosterConsentStatusProps {
  admissionBusy: boolean
  admissionError: string
  capabilities: PosterCapabilitiesState
  consent: boolean
  hasProductImage: boolean
  onConsentChange: (consent: boolean) => void
  onSubmit: () => void
  pollingError: string
  primaryDisabled: boolean
  primaryLabel: string
  result: NormalizedSequenceResult | null
}

export function PosterConsentStatus({
  admissionBusy,
  admissionError,
  capabilities,
  consent,
  hasProductImage,
  onConsentChange,
  onSubmit,
  pollingError,
  primaryDisabled,
  primaryLabel,
  result,
}: PosterConsentStatusProps) {
  const messages: Array<{ alert?: boolean; text: string }> = []
  if (capabilities.error) {
    messages.push({ alert: true, text: capabilities.error })
  }
  if (capabilities.sequenceEnabled === false) {
    messages.push({
      alert: true,
      text: 'Seedream 顺序生成当前未启用，无法生成海报。',
    })
  } else if (capabilities.seedreamConfigured === false) {
    messages.push({
      alert: true,
      text: 'Seedream 当前未配置，完整海报顺序生成不可用。',
    })
  }
  if (!hasProductImage) {
    messages.push({
      alert: true,
      text: '未找到商品参考图，请返回步骤 1 重新上传。',
    })
  }
  if (admissionBusy) {
    messages.push({ text: '正在创建海报生成任务…' })
  } else if (admissionError) {
    messages.push({ alert: true, text: admissionError })
  }
  if (result) {
    messages.push(
      ...overallStatusMessages(result).map((text, index) => ({
        alert:
          index > 0 &&
          (result.status === 'failed' ||
            result.status === 'partial_failed' ||
            result.status === 'interrupted'),
        text,
      })),
    )
  } else if (!admissionBusy && !admissionError) {
    messages.push({ text: '勾选授权后，点击「开始生成海报」。' })
  }
  if (pollingError) {
    messages.push({ alert: true, text: pollingError })
  }

  return (
    <div className="poster-generation-band">
      <label className="provider-consent" htmlFor="provider-consent">
        <input
          checked={consent}
          id="provider-consent"
          onChange={(event) => onConsentChange(event.target.checked)}
          type="checkbox"
        />
        <span>{PROVIDER_CONSENT_TEXT}</span>
      </label>

      <div
        aria-live="polite"
        className="poster-generation-status"
        role="status"
      >
        {messages.slice(0, 4).map((message) => (
          <p
            className={message.alert ? 'poster-generation-status__alert' : ''}
            key={message.text}
            role={message.alert ? 'alert' : undefined}
          >
            {message.text}
          </p>
        ))}
      </div>

      <button
        aria-busy={admissionBusy}
        className="poster-generation-submit"
        disabled={primaryDisabled}
        onClick={onSubmit}
        type="button"
      >
        {primaryLabel}
      </button>
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  useWorkflowCopyCommands,
  useWorkflowDispatch,
  useWorkflowState,
} from '../../state/use-workflow'
import type { CopyStyleId, PlatformId } from '../../types/platform-copy'
import { COPY_STYLE_OPTIONS, PLATFORM_OPTIONS } from '../../types/platform-copy'
import {
  createBasicAuthority,
  createCopyInputAuthoritySync,
  isAdviceCurrentForBasic,
  isConfirmedCopyCurrent,
} from '../../state/workflow-v2/workflow-v2-authorities'
import {
  CopyApiError,
  EMPTY_COPY_RESULT_MESSAGE,
  generatePlatformCopy,
} from './copy-api'
import {
  acquirePendingCopyIntent,
  buildCopyOnlyPayload,
  canonicalJson,
  copyIntentFingerprint,
} from './copy-fingerprint'
import { CopyStyleSelector } from './CopyStyleSelector'
import { CopyVariantSelector } from './CopyVariantSelector'
import { FinalCopyEditor } from './FinalCopyEditor'
import { PlatformSelector } from './PlatformSelector'
import {
  getPlatformCopyValidationError,
  PRODUCT_INFO_MISSING_FOR_COPY_MESSAGE,
} from './validation'

const GENERATION_SETUP_ERROR_MESSAGE = '无法准备文案生成请求，请重试。'

export function PlatformCopyStep() {
  const state = useWorkflowState()
  const { platformCopy, productInfo, workflowV2 } = state
  const dispatch = useWorkflowDispatch()
  const { requestCopy, retryCopy, confirmCopy, cancelCopy } = useWorkflowCopyCommands()
  const immediateBusy = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stateRef = useRef(state)
  const settingsAdmission = useRef(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const validationError = getPlatformCopyValidationError(platformCopy)
  const hasVariants = platformCopy.variants.length > 0
  const v2CopyView = workflowV2.phase === 'active' && workflowV2.view === 'copy'
  const basic = workflowV2.basicAuthority
  const advice = workflowV2.adviceAuthority
  const currentAdvice = Boolean(basic && advice && isAdviceCurrentForBasic(advice, basic))
  const v2CopyInput = basic && advice && currentAdvice
    ? createCopyInputAuthoritySync(basic, advice)
    : null
  const confirmedCopyCurrent = Boolean(
    v2CopyInput && workflowV2.confirmedCopy &&
      isConfirmedCopyCurrent(workflowV2.confirmedCopy, v2CopyInput),
  )
  const selected = platformCopy.selectedVariantIndex === null
    ? null
    : platformCopy.variants[platformCopy.selectedVariantIndex] ?? null
  const dirtyDraft = Boolean(
    selected && (
      // A first generated candidate is still an unconfirmed draft. Once its
      // editable body differs from the selected candidate, make that state
      // explicit even before there is a prior Confirmed Copy to compare.
      (!confirmedCopyCurrent && platformCopy.copyDraft !== selected.body) ||
      (confirmedCopyCurrent &&
        workflowV2.confirmedCopy &&
        (workflowV2.confirmedCopy.body !== platformCopy.copyDraft ||
          workflowV2.confirmedCopy.title !== String(selected.title ?? '') ||
          workflowV2.confirmedCopy.headline !== String(selected.headline ?? '') ||
          workflowV2.confirmedCopy.subline !== String(selected.subline ?? '')))
    ),
  )

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (v2CopyView) headingRef.current?.focus()
  }, [v2CopyView])

  const refreshBasicAuthority = async (
    platform: PlatformId,
    style: CopyStyleId,
    expectedDraftRevision: number,
  ) => {
    if (settingsAdmission.current) return
    const captured = stateRef.current
    const capturedBasic = captured.workflowV2.basicAuthority
    if (captured.workflowV2.phase !== 'active' || !capturedBasic) return
    settingsAdmission.current = true
    setSettingsBusy(true)
    setSettingsError('')
    const capturedEpoch = captured.workflowV2.epoch
    try {
      const productImage =
        capturedBasic.productImage.kind === 'present'
          ? {
              byteSha256: capturedBasic.productImage.byteSha256,
              mimeType: capturedBasic.productImage.mimeType,
              byteSize: capturedBasic.productImage.byteSize,
            }
          : null
      const authority = await createBasicAuthority({
        ...capturedBasic.text.values,
        platform,
        style,
        productImage,
      })
      const live = stateRef.current
      if (
        live.workflowV2.epoch !== capturedEpoch ||
        live.workflowV2.basicDraftRevision !== expectedDraftRevision ||
        live.platformCopy.platform !== platform ||
        live.platformCopy.style !== style
      ) {
        return
      }
      dispatch({
        type: 'COMMIT_V2_BASIC_AUTHORITY',
        workflowEpoch: capturedEpoch,
        draftRevision: expectedDraftRevision,
        authority,
      })
    } catch {
      setSettingsError('无法更新投放平台或文案风格，请重试。')
    } finally {
      settingsAdmission.current = false
      setSettingsBusy(false)
    }
  }

  const handlePlatformChange = (platform: PlatformId) => {
    if (platformCopy.platform === platform || settingsBusy) return
    cancelCopy()
    const expectedDraftRevision = workflowV2.basicDraftRevision + 1
    dispatch({ type: 'UPDATE_STEP_TWO_PLATFORM', platform })
    void refreshBasicAuthority(platform, platformCopy.style, expectedDraftRevision)
  }

  const handleStyleChange = (style: CopyStyleId) => {
    if (platformCopy.style === style || settingsBusy) return
    cancelCopy()
    const expectedDraftRevision = workflowV2.basicDraftRevision + 1
    dispatch({ type: 'UPDATE_STEP_TWO_STYLE', style })
    void refreshBasicAuthority(platformCopy.platform, style, expectedDraftRevision)
  }

  const copyInputSignature = v2CopyInput?.inputSignatureSha256 ?? null
  const hasCurrentGeneratedCopy = Boolean(
    copyInputSignature &&
      workflowV2.generatedCopyInputSignatureSha256 === copyInputSignature &&
      platformCopy.variants.length > 0,
  )

  const updatePlatform = (platform: PlatformId) => {
    dispatch({ type: 'UPDATE_STEP_TWO_PLATFORM', platform })
  }

  const updateStyle = (style: CopyStyleId) => {
    dispatch({ type: 'UPDATE_STEP_TWO_STYLE', style })
  }

  const handleGenerate = async () => {
    if (immediateBusy.current || platformCopy.requestBusy) {
      return
    }
    immediateBusy.current = true

    // The controls are reducer-owned, so their current values are already the
    // durable draft. Clear only the previous request error before validation.
    dispatch({ type: 'SET_COPY_GENERATION_ERROR', error: '' })
    if (!productInfo.values.productInfo.trim()) {
      dispatch({
        type: 'SET_COPY_GENERATION_ERROR',
        error: PRODUCT_INFO_MISSING_FOR_COPY_MESSAGE,
      })
      immediateBusy.current = false
      return
    }

    const capturedPlatform = platformCopy.platform
    const capturedStyle = platformCopy.style
    const payload = buildCopyOnlyPayload(
      productInfo.values,
      capturedPlatform,
      capturedStyle,
    )
    const canonicalPayload = canonicalJson(payload)

    try {
      const fingerprint = await copyIntentFingerprint(canonicalPayload)
      const intent = acquirePendingCopyIntent(
        platformCopy,
        fingerprint,
        () => globalThis.crypto.randomUUID(),
      )

      dispatch({
        type: 'BEGIN_COPY_GENERATION',
        fingerprint: intent.fingerprint,
        idempotencyKey: intent.idempotencyKey,
      })

      try {
        const result = await generatePlatformCopy(
          canonicalPayload,
          intent.idempotencyKey,
        )

        if (result.variants.length === 0) {
          dispatch({
            type: 'COPY_GENERATION_FAILED',
            fingerprint: intent.fingerprint,
            idempotencyKey: intent.idempotencyKey,
            error: EMPTY_COPY_RESULT_MESSAGE,
          })
          return
        }

        dispatch({
          type: 'COPY_GENERATION_SUCCEEDED',
          fingerprint: intent.fingerprint,
          idempotencyKey: intent.idempotencyKey,
          variants: result.variants,
          marketingStrategy: result.marketingStrategy,
          requestId: result.requestId,
          generationPlatform: capturedPlatform,
          generationStyle: capturedStyle,
        })
      } catch (error) {
        dispatch({
          type: 'COPY_GENERATION_FAILED',
          fingerprint: intent.fingerprint,
          idempotencyKey: intent.idempotencyKey,
          error:
            error instanceof CopyApiError
              ? error.userMessage
              : GENERATION_SETUP_ERROR_MESSAGE,
        })
      } finally {
        dispatch({ type: 'END_COPY_GENERATION' })
      }
    } catch {
      dispatch({
        type: 'SET_COPY_GENERATION_ERROR',
        error: GENERATION_SETUP_ERROR_MESSAGE,
      })
    } finally {
      immediateBusy.current = false
    }
  }

  if (v2CopyView && basic && advice && currentAdvice) {
    const loading = Boolean(
      workflowV2.pendingCopyRequest || platformCopy.requestBusy,
    )
    const settingsDisabled = settingsBusy || loading
    const showConfirmGenerate =
      !loading && !workflowV2.copyRequestFailure && !hasCurrentGeneratedCopy
    const showRegenerate =
      !loading && !workflowV2.copyRequestFailure && hasCurrentGeneratedCopy
    const canConfirm = Boolean(
      !loading &&
        selected &&
        validationError === null &&
        v2CopyInput &&
        hasCurrentGeneratedCopy &&
        platformCopy.strategyOwner,
    )
    return (
      <section aria-labelledby="platform-copy-heading" className="platform-copy-step platform-copy-step--v2">
        <header className="platform-copy-v2-intro">
          <div className="platform-copy-v2-heading-row">
            <h1 id="platform-copy-heading" ref={headingRef} tabIndex={-1}>宣传文案</h1>
            <div className="platform-copy-v2-settings">
              <PlatformSelector
                disabled={settingsDisabled}
                onChange={handlePlatformChange}
                value={platformCopy.platform}
              />
              <CopyStyleSelector
                disabled={settingsDisabled}
                onChange={handleStyleChange}
                value={platformCopy.style}
              />
            </div>
          </div>
          <p>请先选择投放平台与文案风格，再点击「确认生成」获取宣传文案。</p>
          {settingsError ? (
            <p className="platform-copy-v2-settings-error" role="alert">{settingsError}</p>
          ) : null}
          {settingsBusy ? (
            <p className="platform-copy-v2-settings-status" role="status">正在同步平台与风格…</p>
          ) : null}
        </header>

        <div aria-busy={loading} className="platform-copy-generation">
          {showConfirmGenerate ? (
            <div className="platform-copy-v2-actions">
              <button
                className="generate-copy-action"
                disabled={settingsBusy || !v2CopyInput}
                onClick={() => requestCopy()}
                type="button"
              >
                确认生成
              </button>
            </div>
          ) : null}
          {loading ? (
            <div aria-live="polite" className="platform-copy-v2-loading" role="status">
              <strong>正在生成宣传文案…</strong>
              <p>系统正在结合商品信息与营销方向生成候选文案。</p>
            </div>
          ) : null}
          {workflowV2.copyRequestFailure ? (
            <div className="platform-copy-v2-error" role="alert">
              <h2>宣传文案生成失败</h2>
              <p>{platformCopy.copyGenerationError || '暂时无法生成文案，请稍后重试。'}</p>
              <button className="generate-copy-action" onClick={retryCopy} type="button">重新生成</button>
            </div>
          ) : null}
          {showRegenerate ? (
            <div className="platform-copy-v2-actions">
              <button
                className="generate-copy-action"
                disabled={settingsBusy}
                onClick={() => requestCopy({ force: true })}
                type="button"
              >
                重新生成
              </button>
            </div>
          ) : null}
          {dirtyDraft ? <p className="platform-copy-v2-dirty">当前修改尚未确认</p> : null}
          <div className={`platform-copy-workspace${hasVariants ? ' platform-copy-workspace--generated' : ''}`}>
            {hasVariants ? (
              <CopyVariantSelector
                onSelect={(index) => dispatch({ type: 'SELECT_STEP_TWO_VARIANT', index })}
                selectedIndex={platformCopy.selectedVariantIndex}
                variants={platformCopy.variants}
              />
            ) : null}
            <FinalCopyEditor
              hint="您可以在此自由编辑选择的文案。"
              label="最终文案"
              onChange={(value) => dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value })}
              validationError={validationError}
              value={platformCopy.copyDraft}
            />
          </div>
        </div>
        <div className="platform-copy-navigation platform-copy-navigation--v2">
          <button
            className="platform-copy-navigation__previous"
            onClick={() => dispatch({ type: 'RETURN_FROM_V2_COPY' })}
            type="button"
          >
            返回创作工作台
          </button>
          <button
            className="platform-copy-navigation__next"
            disabled={!canConfirm}
            onClick={confirmCopy}
            type="button"
          >
            确认宣传文案
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="platform-copy-heading"
      className="platform-copy-step"
    >
      <h1 id="platform-copy-heading">步骤 2：平台与文案</h1>

      <div
        aria-busy={platformCopy.requestBusy}
        className="platform-copy-generation"
      >
        <div className="platform-copy-controls">
          {workflowV2.phase === 'active' ? (
            <div className="platform-copy-committed-settings" aria-label="已确认的创作设置">
              <div><span>投放平台</span><strong>{PLATFORM_OPTIONS.find((item) => item.id === platformCopy.platform)?.label}</strong></div>
              <div><span>文案风格</span><strong>{COPY_STYLE_OPTIONS.find((item) => item.id === platformCopy.style)?.label}</strong></div>
              <button className="text-action" onClick={() => dispatch({ type: 'GO_TO_STEP_ONE' })} type="button">
                返回基本信息修改
              </button>
            </div>
          ) : (
            <>
              <PlatformSelector
                disabled={platformCopy.requestBusy}
                onChange={updatePlatform}
                value={platformCopy.platform}
              />
              <CopyStyleSelector
                disabled={platformCopy.requestBusy}
                onChange={updateStyle}
                value={platformCopy.style}
              />
            </>
          )}
          <button
            aria-busy={platformCopy.requestBusy}
            className="generate-copy-action"
            disabled={platformCopy.requestBusy}
            onClick={handleGenerate}
            type="button"
          >
            {platformCopy.requestBusy ? (
              <span role="status">正在生成三版文案…</span>
            ) : (
              '生成三版文案'
            )}
          </button>
        </div>

        {platformCopy.copyGenerationError ? (
          <p className="copy-generation-error" role="alert">
            {platformCopy.copyGenerationError}
          </p>
        ) : null}

        <div
          className={`platform-copy-workspace${
            hasVariants ? ' platform-copy-workspace--generated' : ''
          }`}
        >
          {hasVariants ? (
            <CopyVariantSelector
              onSelect={(index) =>
                dispatch({ type: 'SELECT_STEP_TWO_VARIANT', index })
              }
              selectedIndex={platformCopy.selectedVariantIndex}
              variants={platformCopy.variants}
            />
          ) : null}

          <FinalCopyEditor
            onChange={(value) =>
              dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value })
            }
            validationError={validationError}
            value={platformCopy.copyDraft}
          />
        </div>
      </div>

      <div className="platform-copy-navigation">
        <button
          className="platform-copy-navigation__previous"
          disabled={platformCopy.requestBusy}
          onClick={() => dispatch({ type: 'GO_TO_STEP_ONE' })}
          type="button"
        >
          上一步
        </button>
        <button
          className="platform-copy-navigation__next"
          disabled={platformCopy.requestBusy || validationError !== null}
          onClick={() => dispatch({ type: 'COMPLETE_STEP_TWO' })}
          type="button"
        >
          下一步
        </button>
      </div>
    </section>
  )
}

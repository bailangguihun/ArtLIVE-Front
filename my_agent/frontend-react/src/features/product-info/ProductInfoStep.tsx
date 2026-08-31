import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  useWorkflowAdviceCommands,
  useWorkflowDispatch,
  useWorkflowState,
} from '../../state/use-workflow'
import { PRODUCT_INFO_LIMITS } from '../../types/product-info'
import type { ProductInfoField } from '../../types/product-info'
import { ProductImageField } from './ProductImageField'
import { canContinueFromProductInfo } from './validation'
import {
  createBasicAuthority,
  isAdviceCurrentForBasic,
} from '../../state/workflow-v2/workflow-v2-authorities'
import { sha256Blob } from '../poster-editor/poster-signature'

export function ProductInfoStep() {
  const state = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const { requestAdvice } = useWorkflowAdviceCommands()
  const { productInfo, platformCopy, workflowV2 } = state
  const { errors, productImage, values } = productInfo
  const canContinue = canContinueFromProductInfo(values)
  const [hashing, setHashing] = useState(false)
  const stateRef = useRef(state)
  const busyRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const updateField = (field: ProductInfoField, value: string) => {
    dispatch({ type: 'UPDATE_STEP_ONE_FIELD', field, value })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    dispatch({ type: 'VALIDATE_STEP_ONE' })

    if (!canContinue || workflowV2.phase !== 'active' || busyRef.current) return
    busyRef.current = true
    setHashing(true)
    const requestId = globalThis.crypto.randomUUID()
    const captured = stateRef.current
    const pending = {
      requestId,
      workflowEpoch: captured.workflowV2.epoch,
      draftRevision: captured.workflowV2.basicDraftRevision,
    }
    dispatch({ type: 'BEGIN_V2_BASIC_COMMIT', pending })

    try {
      const capturedImage = captured.productInfo.productImage
      const byteSha256 = capturedImage ? await sha256Blob(capturedImage.file) : null
      const live = stateRef.current
      const imageStillSame = live.productInfo.productImage?.file === capturedImage?.file
      const valuesStillSame = JSON.stringify(live.productInfo.values) === JSON.stringify(captured.productInfo.values)
      if (
        live.workflowV2.epoch !== pending.workflowEpoch ||
        live.workflowV2.basicDraftRevision !== pending.draftRevision ||
        live.platformCopy.platform !== captured.platformCopy.platform ||
        live.platformCopy.style !== captured.platformCopy.style ||
        !imageStillSame ||
        !valuesStillSame
      ) {
        dispatch({ ...pending, type: 'FAIL_V2_BASIC_COMMIT', error: '内容已更新，请重新提交。' })
        return
      }
      const authority = await createBasicAuthority({
        ...captured.productInfo.values,
        platform: captured.platformCopy.platform,
        style: captured.platformCopy.style,
        productImage: capturedImage && byteSha256
          ? { byteSha256, mimeType: capturedImage.mimeType, byteSize: capturedImage.size }
          : null,
      })
      dispatch({ type: 'COMMIT_V2_BASIC', ...pending, authority })
      const cachedAdvice = captured.workflowV2.adviceAuthority
      if (!cachedAdvice || !isAdviceCurrentForBasic(cachedAdvice, authority)) {
        requestAdvice({
          authority,
          workflowEpoch: pending.workflowEpoch,
          draftRevision: pending.draftRevision,
        })
      }
    } catch {
      dispatch({ ...pending, type: 'FAIL_V2_BASIC_COMMIT', error: '图片身份计算失败，请重试。' })
    } finally {
      busyRef.current = false
      setHashing(false)
    }
  }

  return (
    <section aria-labelledby="product-info-heading" className="product-info-step">
      <h1 id="product-info-heading">01 基本信息</h1>

      <form className="product-info-form" noValidate onSubmit={handleSubmit}>
        <div className="product-info-fields">
          <div className="form-field">
            <div className="field-heading">
              <label className="field-label" htmlFor="product-info">
                产品信息
              </label>
              <span className="character-count" id="product-info-count">
                {values.productInfo.length} / {PRODUCT_INFO_LIMITS.productInfo}
              </span>
            </div>
            <textarea
              aria-describedby={
                errors.productInfo
                  ? 'product-info-hint product-info-example product-info-count product-info-error'
                  : 'product-info-hint product-info-example product-info-count'
              }
              aria-invalid={errors.productInfo ? 'true' : 'false'}
              className="text-control text-control--product-info"
              id="product-info"
              maxLength={PRODUCT_INFO_LIMITS.productInfo}
              onChange={(event) =>
                updateField('productInfo', event.target.value)
              }
              required
              value={values.productInfo}
            />
            <p className="field-hint" id="product-info-hint">
              请填写商品品类，核心卖点/功能，使用人群/场景，价格区间，产品定位等
            </p>
            <p className="field-hint field-hint--example" id="product-info-example">
              示例：便携 USB 小风扇，三档风速，8000mAh 可充手机，适合露营和通勤，静音设计，百元价位。
            </p>
            {errors.productInfo ? (
              <p className="field-error" id="product-info-error" role="alert">
                {errors.productInfo}
              </p>
            ) : null}
          </div>

          <button
            className="primary-action"
            disabled={!canContinue || hashing || workflowV2.phase !== 'active'}
            type="submit"
          >
            {hashing ? '正在确认信息…' : '下一步'}
          </button>
        </div>

        <ProductImageField image={productImage} />
      </form>
      {workflowV2.basicCommitError ? <p className="field-error" role="alert">{workflowV2.basicCommitError}</p> : null}
    </section>
  )
}

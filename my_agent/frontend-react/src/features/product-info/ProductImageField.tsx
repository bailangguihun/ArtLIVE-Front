import { useRef, useState } from 'react'
import { ImagePlaceholderIcon } from '../../components/icons/ImagePlaceholderIcon'
import { useWorkflowDispatch } from '../../state/use-workflow'
import type { ProductImageSelection } from '../../types/product-info'
import { PRODUCT_IMAGE_ACCEPT } from '../../types/product-info'
import {
  isAcceptedProductImage,
  PRODUCT_IMAGE_TYPE_MESSAGE,
  toProductImageSelection,
} from './validation'

interface ProductImageFieldProps {
  image: ProductImageSelection | null
}

export function ProductImageField({ image }: ProductImageFieldProps) {
  const dispatch = useWorkflowDispatch()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!isAcceptedProductImage(file)) {
      setUploadError(PRODUCT_IMAGE_TYPE_MESSAGE)
      return
    }

    const previewUrl = URL.createObjectURL(file)
    if (image) {
      URL.revokeObjectURL(image.previewUrl)
    }
    setUploadError(null)
    dispatch({
      type: 'REPLACE_STEP_ONE_IMAGE',
      image: toProductImageSelection(file, previewUrl),
    })
  }

  const handleRemove = () => {
    setUploadError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
    if (image) {
      URL.revokeObjectURL(image.previewUrl)
    }
    dispatch({ type: 'REMOVE_STEP_ONE_IMAGE' })
  }

  return (
    <div className="product-image-field">
      <span className="field-label" id="product-image-label">
        商品参考图上传
      </span>

      <input
        accept={PRODUCT_IMAGE_ACCEPT}
        aria-describedby={
          uploadError ? 'product-image-help product-image-error' : 'product-image-help'
        }
        aria-invalid={uploadError ? 'true' : undefined}
        aria-labelledby="product-image-label product-image-action-label"
        className="file-input"
        id="product-image-input"
        onChange={handleFileChange}
        ref={inputRef}
        type="file"
      />
      <label className="product-image-canvas" htmlFor="product-image-input">
        {image ? (
          <img
            alt={`商品参考图预览：${image.name}`}
            className="product-image-preview"
            src={image.previewUrl}
          />
        ) : (
          <div className="product-image-empty" aria-hidden="true">
            <ImagePlaceholderIcon />
            <span className="product-image-empty-copy" id="product-image-help">
              上传后预览图会显示在此处（居中）。
            </span>
            <span className="product-image-formats">
              PNG · JPG · JPEG · WebP
            </span>
          </div>
        )}
        <span className="visually-hidden" id="product-image-action-label">
          {image ? '替换图片' : '选择图片'}
        </span>
      </label>

      {image ? (
        <div
          className="product-image-meta"
          id="product-image-help"
          aria-live="polite"
        >
          <span>已选择：{image.name || '商品图'}</span>
        </div>
      ) : null}

      {uploadError ? (
        <p className="field-error" id="product-image-error" role="alert">
          {uploadError}
        </p>
      ) : null}

      {image ? (
        <div className="product-image-actions">
          <button
            className="text-action"
            onClick={handleRemove}
            type="button"
          >
            移除图片
          </button>
        </div>
      ) : null}
    </div>
  )
}

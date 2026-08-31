import {
  COPY_STYLE_OPTIONS,
  isCopyStyleId,
} from '../../types/platform-copy'
import type { CopyStyleId } from '../../types/platform-copy'

interface CopyStyleSelectorProps {
  disabled: boolean
  onChange: (style: CopyStyleId) => void
  value: CopyStyleId
}

export function CopyStyleSelector({
  disabled,
  onChange,
  value,
}: CopyStyleSelectorProps) {
  return (
    <fieldset className="option-group option-group--style">
      <legend>文案风格</legend>
      <div className="option-group__options option-group__options--style">
        {COPY_STYLE_OPTIONS.map((option) => (
          <label className="option-group__option" htmlFor={option.id} key={option.id}>
            <input
              checked={value === option.id}
              disabled={disabled}
              id={option.id}
              name="copy-style"
              onChange={(event) => {
                if (isCopyStyleId(event.target.value)) {
                  onChange(event.target.value)
                }
              }}
              type="radio"
              value={option.id}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

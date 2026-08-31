import {
  isPlatformId,
  PLATFORM_OPTIONS,
} from '../../types/platform-copy'
import type { PlatformId } from '../../types/platform-copy'

interface PlatformSelectorProps {
  disabled: boolean
  onChange: (platform: PlatformId) => void
  value: PlatformId
}

export function PlatformSelector({
  disabled,
  onChange,
  value,
}: PlatformSelectorProps) {
  return (
    <fieldset className="option-group option-group--platform">
      <legend>投放平台</legend>
      <div className="option-group__options option-group__options--platform">
        {PLATFORM_OPTIONS.map((option) => (
          <label className="option-group__option" htmlFor={option.id} key={option.id}>
            <input
              checked={value === option.id}
              disabled={disabled}
              id={option.id}
              name="target-platform"
              onChange={(event) => {
                if (isPlatformId(event.target.value)) {
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

import type { CopyVariant } from '../../types/platform-copy'

interface CopyVariantSelectorProps {
  onSelect: (index: number) => void
  selectedIndex: number | null
  variants: CopyVariant[]
}

export function CopyVariantSelector({
  onSelect,
  selectedIndex,
  variants,
}: CopyVariantSelectorProps) {
  return (
    <fieldset className="copy-variant-selector">
      <legend>选择文案</legend>
      <div className="copy-variant-selector__grid">
        {variants.map((variant, index) => {
          const inputId = `copy-variant-${index}`
          const selected = selectedIndex === index
          return (
            <div
              className={`copy-variant${selected ? ' copy-variant--selected' : ''}`}
              key={inputId}
            >
              <input
                checked={selected}
                className="copy-variant__radio"
                id={inputId}
                name="copy-variant"
                onChange={() => onSelect(index)}
                type="radio"
                value={index}
              />
              <label className="copy-variant__heading" htmlFor={inputId}>
                方案 {index + 1}
              </label>
              <p className="copy-variant__body">{variant.body}</p>
              <button
                className="copy-variant__select"
                onClick={() => onSelect(index)}
                type="button"
              >
                选用
              </button>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

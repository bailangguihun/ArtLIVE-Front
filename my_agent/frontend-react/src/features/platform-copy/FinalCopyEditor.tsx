interface FinalCopyEditorProps {
  hint?: string
  label?: string
  onChange: (value: string) => void
  validationError: string | null
  value: string
}

export function FinalCopyEditor({
  hint,
  label = '最终文案（可编辑）',
  onChange,
  validationError,
  value,
}: FinalCopyEditorProps) {
  const describedBy = validationError
    ? 'final-copy-count final-copy-validation'
    : hint
      ? 'final-copy-count final-copy-hint'
      : 'final-copy-count'

  return (
    <div className="final-copy-editor">
      <div className="final-copy-editor__heading">
        <div className="final-copy-editor__title">
          <label htmlFor="final-copy">{label}</label>
          {hint ? <p className="final-copy-editor__hint" id="final-copy-hint">{hint}</p> : null}
        </div>
        <span id="final-copy-count">{value.length} / 5000</span>
      </div>
      <textarea
        aria-describedby={describedBy}
        aria-invalid={validationError ? 'true' : undefined}
        id="final-copy"
        maxLength={5000}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {validationError ? (
        <p
          className="platform-copy-validation"
          id="final-copy-validation"
          key={validationError}
          role="alert"
        >
          {validationError}
        </p>
      ) : null}
    </div>
  )
}

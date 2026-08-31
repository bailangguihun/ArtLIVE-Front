import {
  useId,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type {
  CompletePosterLayout,
  PosterEditorPanel,
  PosterImage,
  PosterShape,
  PosterTextBox,
  PosterCopySnapshot,
} from '../../types/poster-editor'
import {
  createCustomTextBox,
  createDefaultShape,
  SHAPE_ADD_OPTIONS,
  SHAPE_LABELS,
} from './poster-defaults'
import { AVAILABLE_POSTER_FONTS } from './poster-fonts'
import { POSTER_IMAGE_ACCEPT } from './poster-resources'
import {
  formatPosterBufferedNumber,
  parsePosterBufferedNumber,
  stepPosterBufferedNumber,
  type PosterBufferedNumberSpec,
} from './poster-buffered-number'

interface PosterEditorInspectorProps {
  layout: CompletePosterLayout
  panel: PosterEditorPanel
  selectedTextId: string | null
  selectedShapeId: string | null
  selectedImageId: string | null
  copySnapshot: PosterCopySnapshot
  imageStatus: string
  busy: boolean
  onPanel: (panel: PosterEditorPanel) => void
  onSelectText: (id: string) => void
  onSelectShape: (id: string) => void
  onSelectImage: (id: string) => void
  onLayout: (layout: CompletePosterLayout) => void
  onUpload: (file: File) => Promise<void>
  onRemoveWhite: () => Promise<void>
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="poster-control">
      <span>{label}</span>
      {children}
    </label>
  )
}

function roleLabel(box: PosterTextBox) {
  if (box.role === 'title') return '标题'
  if (box.role === 'headline') return '主卖点'
  if (box.role === 'subline') return '补充句'
  return `自定义 ${box.role.slice('custom-'.length)}`
}

const TEXT_FONT_SIZE = { minimum: 12, maximum: 160, step: 2 } as const
const TEXT_STROKE_WIDTH = { minimum: 1, maximum: 24, step: 1 } as const
const NORMALIZED_POSITION = { minimum: 0, maximum: 1, step: 0.01 } as const
const NORMALIZED_OPACITY = { minimum: 0, maximum: 1, step: 0.05 } as const
const SHAPE_STROKE_WIDTH = { minimum: 1, maximum: 64, step: 1 } as const
const SHAPE_SIZE = { minimum: 0.01, maximum: 1, step: 0.01 } as const
const LINE_SIZE = { minimum: -1, maximum: 1, step: 0.01, allowNegative: true } as const
const IMAGE_SIZE = { minimum: 0.04, maximum: 1, step: 0.01 } as const

interface BufferedNumberInputProps {
  readonly ariaLabel: string
  readonly value: number
  readonly spec: PosterBufferedNumberSpec
  readonly disabled: boolean
  readonly onValue: (value: number) => void
}

function BufferedNumberInput({
  ariaLabel,
  value,
  spec,
  disabled,
  onValue,
}: BufferedNumberInputProps) {
  const descriptionId = useId()
  const [buffer, setBuffer] = useState(() => formatPosterBufferedNumber(value))
  const [focused, setFocused] = useState(false)
  const lastValid = useRef(value)
  const displayValue = focused ? buffer : formatPosterBufferedNumber(value)
  const parsed = parsePosterBufferedNumber(displayValue, spec)
  const invalid = focused && parsed.kind !== 'valid'

  const accept = (next: number, display = formatPosterBufferedNumber(next)) => {
    const changed = next !== lastValid.current
    lastValid.current = next
    setBuffer(display)
    if (changed) onValue(next)
  }

  const commitOrRevert = () => {
    const current = parsePosterBufferedNumber(buffer, spec)
    if (current.kind === 'valid') {
      accept(current.value)
      return
    }
    setBuffer(formatPosterBufferedNumber(lastValid.current))
  }

  const rangeMessage = `范围 ${spec.minimum} 至 ${spec.maximum}，步进 ${spec.step}。`
  const errorMessage = invalid
    ? parsed.kind === 'out_of_range'
      ? `输入超出允许范围。${rangeMessage}`
      : `请输入有效数字。${rangeMessage}`
    : rangeMessage

  return (
    <>
      <input
        aria-label={ariaLabel}
        aria-describedby={descriptionId}
        aria-invalid={invalid || undefined}
        aria-valuemax={spec.maximum}
        aria-valuemin={spec.minimum}
        aria-valuenow={value}
        aria-valuetext={buffer}
        className={invalid ? 'poster-buffered-number poster-buffered-number--invalid' : 'poster-buffered-number'}
        disabled={disabled}
        inputMode="decimal"
        max={spec.maximum}
        min={spec.minimum}
        onBlur={() => {
          commitOrRevert()
          setFocused(false)
        }}
        onChange={(event) => {
          const nextBuffer = event.currentTarget.value
          setBuffer(nextBuffer)
          const next = parsePosterBufferedNumber(nextBuffer, spec)
          if (next.kind === 'valid') accept(next.value, nextBuffer)
        }}
        onFocus={() => {
          lastValid.current = value
          setBuffer(formatPosterBufferedNumber(value))
          setFocused(true)
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setBuffer(formatPosterBufferedNumber(lastValid.current))
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
            return
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const current = parsed.kind === 'valid' ? parsed.value : lastValid.current
          const next = stepPosterBufferedNumber(
            current,
            event.key === 'ArrowUp' ? 1 : -1,
            spec,
          )
          accept(next)
        }}
        role="spinbutton"
        step={spec.step}
        type="text"
        value={displayValue}
      />
      <small className={invalid ? 'poster-buffered-number__help poster-buffered-number__help--invalid' : 'poster-buffered-number__help'} id={descriptionId}>
        {errorMessage}
      </small>
    </>
  )
}

function nextCustomIndex(layout: CompletePosterLayout) {
  return (
    layout.textBoxes.reduce((largest, box) => {
      const match = /^custom-(\d+)$/.exec(box.role)
      return match ? Math.max(largest, Number(match[1])) : largest
    }, 0) + 1
  )
}

function TextInspector({
  layout,
  selectedId,
  copySnapshot,
  busy,
  onSelect,
  onLayout,
}: {
  layout: CompletePosterLayout
  selectedId: string | null
  copySnapshot: PosterCopySnapshot
  busy: boolean
  onSelect: (id: string) => void
  onLayout: (layout: CompletePosterLayout) => void
}) {
  const selected = layout.textBoxes.find((box) => box.id === selectedId) ?? null
  const updateSelected = (update: Partial<PosterTextBox>) => {
    if (!selected) return
    onLayout({
      ...layout,
      textBoxes: layout.textBoxes.map((box) =>
        box.id === selected.id ? { ...box, ...update } : box,
      ),
    })
  }

  const addText = () => {
    const index = nextCustomIndex(layout)
    const textBox = createCustomTextBox(index)
    onLayout({ ...layout, textBoxes: [...layout.textBoxes, textBox] })
    onSelect(textBox.id)
  }

  const fillAiSlogan = () => {
    const valueByRole = {
      title: String(copySnapshot.title || ''),
      headline: String(copySnapshot.headline || ''),
      subline: String(copySnapshot.subline || ''),
    }
    onLayout({
      ...layout,
      textBoxes: layout.textBoxes.map((box) =>
        box.role === 'title' || box.role === 'headline' || box.role === 'subline'
          ? { ...box, text: valueByRole[box.role] }
          : box,
      ),
    })
  }

  return (
    <div className="poster-inspector__content" data-testid="text-inspector">
      <section className="poster-inspector__list" aria-label="文字框列表">
        <button className="poster-tool-button poster-tool-button--accent" disabled={busy} onClick={addText} type="button">
          ➕ 添加文本框
        </button>
        <div className="poster-object-list">
          {layout.textBoxes.map((box) => (
            <button
              aria-pressed={box.id === selectedId}
              className={box.id === selectedId ? 'poster-object-list__item poster-object-list__item--selected' : 'poster-object-list__item'}
              key={box.id}
              onClick={() => onSelect(box.id)}
              type="button"
            >
              <span>{roleLabel(box)}</span>
              <small>{box.text || '（空文本）'}</small>
            </button>
          ))}
        </div>
        <button className="poster-tool-button" disabled={busy} onClick={fillAiSlogan} type="button">
          填入 AI 标语
        </button>
      </section>

      <section className="poster-inspector__properties" aria-label="文字属性">
        <Control label="默认字体（未单独设置的文本框）">
          <select
            disabled={busy}
            onChange={(event) => onLayout({ ...layout, fontId: event.currentTarget.value })}
            value={layout.fontId}
          >
            {AVAILABLE_POSTER_FONTS.map((font) => (
              <option key={font.id} value={font.id}>{font.label}</option>
            ))}
          </select>
        </Control>
        {selected ? (
          <>
            <Control label="文案">
              <textarea
                disabled={busy}
                maxLength={60}
                onChange={(event) => updateSelected({ text: event.currentTarget.value })}
                rows={2}
                value={selected.text}
              />
            </Control>
            <Control label="本框字体">
              <select
                disabled={busy}
                onChange={(event) => updateSelected({ fontId: event.currentTarget.value || null })}
                value={selected.fontId ?? ''}
              >
                <option value="">跟随默认字体</option>
                {AVAILABLE_POSTER_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>{font.label}</option>
                ))}
              </select>
            </Control>
            <div className="poster-control-grid">
              <Control label="字号">
                <BufferedNumberInput ariaLabel="字号" disabled={busy} key={selected.id} onValue={(fontSize) => updateSelected({ fontSize })} spec={TEXT_FONT_SIZE} value={selected.fontSize} />
              </Control>
              <Control label="填充色">
                <input disabled={busy} onChange={(event) => updateSelected({ color: event.currentTarget.value })} type="color" value={selected.color} />
              </Control>
              <Control label="对齐">
                <select disabled={busy} onChange={(event) => updateSelected({ align: event.currentTarget.value as 'center' | 'left' })} value={selected.align}>
                  <option value="center">居中</option>
                  <option value="left">左对齐</option>
                </select>
              </Control>
            </div>
            <label className="poster-check-control">
              <input checked={selected.strokeEnabled} disabled={busy} onChange={(event) => updateSelected({ strokeEnabled: event.currentTarget.checked })} type="checkbox" />
              <span>启用字体描边</span>
            </label>
            {selected.strokeEnabled ? (
              <div className="poster-control-grid poster-control-grid--two">
                <Control label="描边粗细">
                  <BufferedNumberInput ariaLabel="描边粗细" disabled={busy} key={selected.id} onValue={(strokeWidth) => updateSelected({ strokeWidth })} spec={TEXT_STROKE_WIDTH} value={selected.strokeWidth} />
                </Control>
                <Control label="描边颜色">
                  <input disabled={busy} onChange={(event) => updateSelected({ strokeColor: event.currentTarget.value })} type="color" value={selected.strokeColor} />
                </Control>
              </div>
            ) : (
              <p className="poster-inspector__hint">未启用：导出为纯色字，无描边。</p>
            )}
            <label className="poster-check-control">
              <input checked={selected.showBox} disabled={busy} onChange={(event) => updateSelected({ showBox: event.currentTarget.checked })} type="checkbox" />
              <span>导出半透明底框（会像灰边，默认关）</span>
            </label>
            <div className="poster-control-grid poster-control-grid--two">
              <Control label="水平">
                <BufferedNumberInput ariaLabel="水平" disabled={busy} key={selected.id} onValue={(x) => updateSelected({ x })} spec={NORMALIZED_POSITION} value={selected.x} />
              </Control>
              <Control label="垂直">
                <BufferedNumberInput ariaLabel="垂直" disabled={busy} key={selected.id} onValue={(y) => updateSelected({ y })} spec={NORMALIZED_POSITION} value={selected.y} />
              </Control>
            </div>
            {selected.role.startsWith('custom-') ? (
              <button
                className="poster-tool-button poster-action--destructive"
                disabled={busy}
                onClick={() => onLayout({ ...layout, textBoxes: layout.textBoxes.filter((box) => box.id !== selected.id) })}
                type="button"
              >
                删除此文本框
              </button>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}

function ShapeInspector({
  layout,
  selectedId,
  busy,
  onSelect,
  onLayout,
}: {
  layout: CompletePosterLayout
  selectedId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onLayout: (layout: CompletePosterLayout) => void
}) {
  const selected = layout.shapes.find((shape) => shape.id === selectedId) ?? null
  const updateSelected = (update: Partial<PosterShape>) => {
    if (!selected) return
    onLayout({ ...layout, shapes: layout.shapes.map((shape) => shape.id === selected.id ? { ...shape, ...update } : shape) })
  }
  const addShape = (type: PosterShape['type']) => {
    const shape = createDefaultShape(type, `shape-${type}-${globalThis.crypto.randomUUID()}`)
    onLayout({ ...layout, shapes: [...layout.shapes, shape] })
    onSelect(shape.id)
  }
  const copySelected = () => {
    if (!selected) return
    const copy = {
      ...selected,
      id: `shape-${selected.type}-${globalThis.crypto.randomUUID()}`,
      x: Math.min(0.92, selected.x + 0.03),
      y: Math.min(0.92, selected.y + 0.03),
    }
    onLayout({ ...layout, shapes: [...layout.shapes, copy] })
    onSelect(copy.id)
  }

  return (
    <div className="poster-inspector__content" data-testid="shape-inspector">
      <section className="poster-inspector__list">
        <div className="poster-shape-tools" aria-label="添加图形">
          {SHAPE_ADD_OPTIONS.map((option) => (
            <button disabled={busy} key={option.type} onClick={() => addShape(option.type)} type="button">{option.label}</button>
          ))}
        </div>
        <label className="poster-control">
          <span>图形列表</span>
          <select disabled={busy || layout.shapes.length === 0} onChange={(event) => event.currentTarget.value && onSelect(event.currentTarget.value)} value={selectedId ?? ''}>
            <option value="">（未选中）</option>
            {layout.shapes.map((shape, index) => (
              <option key={shape.id} value={shape.id}>{SHAPE_LABELS[shape.type]} {index + 1}</option>
            ))}
          </select>
        </label>
        {layout.shapes.length === 0 ? <p className="poster-inspector__empty">暂无图形，点上方按钮添加。</p> : null}
      </section>
      <section className="poster-inspector__properties">
        {selected ? (
          <>
            <p className="poster-inspector__current">当前：{SHAPE_LABELS[selected.type]}</p>
            <div className="poster-inline-actions">
              <button disabled={busy} onClick={copySelected} type="button">复制图形</button>
              <button className="poster-action--destructive" disabled={busy} onClick={() => onLayout({ ...layout, shapes: layout.shapes.filter((shape) => shape.id !== selected.id) })} type="button">删除图形</button>
            </div>
            {selected.type !== 'line' ? (
              <>
                <Control label="填充颜色"><input disabled={busy} onChange={(event) => updateSelected({ fill: event.currentTarget.value })} type="color" value={selected.fill} /></Control>
                <Control label="填充透明度"><BufferedNumberInput ariaLabel="填充透明度" disabled={busy} key={selected.id} onValue={(fillOpacity) => updateSelected({ fillOpacity })} spec={NORMALIZED_OPACITY} value={selected.fillOpacity} /></Control>
              </>
            ) : null}
            <Control label="线条颜色"><input disabled={busy} onChange={(event) => updateSelected({ stroke: event.currentTarget.value })} type="color" value={selected.stroke} /></Control>
            <div className="poster-control-grid poster-control-grid--two">
              <Control label="线宽"><BufferedNumberInput ariaLabel="线宽" disabled={busy} key={selected.id} onValue={(strokeWidth) => updateSelected({ strokeWidth })} spec={SHAPE_STROKE_WIDTH} value={selected.strokeWidth} /></Control>
              <Control label="线条透明度"><BufferedNumberInput ariaLabel="线条透明度" disabled={busy} key={selected.id} onValue={(strokeOpacity) => updateSelected({ strokeOpacity })} spec={NORMALIZED_OPACITY} value={selected.strokeOpacity} /></Control>
            </div>
            <div className="poster-control-grid poster-control-grid--two">
              <Control label="水平"><BufferedNumberInput ariaLabel="水平" disabled={busy} key={selected.id} onValue={(x) => updateSelected({ x })} spec={NORMALIZED_POSITION} value={selected.x} /></Control>
              <Control label="垂直"><BufferedNumberInput ariaLabel="垂直" disabled={busy} key={selected.id} onValue={(y) => updateSelected({ y })} spec={NORMALIZED_POSITION} value={selected.y} /></Control>
              <Control label="宽度"><BufferedNumberInput ariaLabel="宽度" disabled={busy} key={selected.id} onValue={(w) => updateSelected({ w })} spec={selected.type === 'line' ? LINE_SIZE : SHAPE_SIZE} value={selected.w} /></Control>
              <Control label="高度"><BufferedNumberInput ariaLabel="高度" disabled={busy} key={selected.id} onValue={(h) => updateSelected({ h })} spec={selected.type === 'line' ? LINE_SIZE : SHAPE_SIZE} value={selected.h} /></Control>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}

function ImageInspector({
  layout,
  selectedId,
  imageStatus,
  busy,
  onSelect,
  onLayout,
  onUpload,
  onRemoveWhite,
}: {
  layout: CompletePosterLayout
  selectedId: string | null
  imageStatus: string
  busy: boolean
  onSelect: (id: string) => void
  onLayout: (layout: CompletePosterLayout) => void
  onUpload: (file: File) => Promise<void>
  onRemoveWhite: () => Promise<void>
}) {
  const selected = layout.images.find((image) => image.id === selectedId) ?? null
  const updateSelected = (update: Partial<PosterImage>) => {
    if (!selected) return
    onLayout({ ...layout, images: layout.images.map((image) => image.id === selected.id ? { ...image, ...update } : image) })
  }
  return (
    <div className="poster-inspector__content" data-testid="image-inspector">
      <section className="poster-inspector__list">
        <label className={`poster-file-control${busy ? ' poster-file-control--disabled' : ''}`}>
          <span>上传商标或其他图片</span>
          <input
            accept={POSTER_IMAGE_ACCEPT}
            disabled={busy}
            onChange={(event) => {
              const input = event.currentTarget
              const file = input.files?.[0]
              if (file) void onUpload(file).finally(() => { input.value = '' })
            }}
            type="file"
          />
        </label>
        <label className="poster-control">
          <span>图片列表</span>
          <select disabled={busy || layout.images.length === 0} onChange={(event) => event.currentTarget.value && onSelect(event.currentTarget.value)} value={selectedId ?? ''}>
            <option value="">（未选中）</option>
            {layout.images.map((image, index) => <option key={image.id} value={image.id}>{image.name || `图片 ${index + 1}`}</option>)}
          </select>
        </label>
        {layout.images.length === 0 ? <p className="poster-inspector__empty">暂无图片。</p> : null}
        <p aria-live="polite" className="poster-image-status">{imageStatus}</p>
      </section>
      <section className="poster-inspector__properties">
        {selected ? (
          <>
            <p className="poster-inspector__current">当前：{selected.name}</p>
            <div className="poster-inline-actions poster-inline-actions--stack">
              <button disabled={busy} onClick={() => void onRemoveWhite()} type="button">一键去除白底</button>
              <button className="poster-action--destructive" disabled={busy} onClick={() => onLayout({ ...layout, images: layout.images.filter((image) => image.id !== selected.id) })} type="button">删除图片</button>
            </div>
            <div className="poster-control-grid poster-control-grid--two">
              <Control label="水平"><BufferedNumberInput ariaLabel="水平" disabled={busy} key={selected.id} onValue={(x) => updateSelected({ x })} spec={NORMALIZED_POSITION} value={selected.x} /></Control>
              <Control label="垂直"><BufferedNumberInput ariaLabel="垂直" disabled={busy} key={selected.id} onValue={(y) => updateSelected({ y })} spec={NORMALIZED_POSITION} value={selected.y} /></Control>
              <Control label="宽度"><BufferedNumberInput ariaLabel="宽度" disabled={busy} key={selected.id} onValue={(w) => updateSelected({ w })} spec={IMAGE_SIZE} value={selected.w} /></Control>
              <Control label="高度"><BufferedNumberInput ariaLabel="高度" disabled={busy} key={selected.id} onValue={(h) => updateSelected({ h })} spec={IMAGE_SIZE} value={selected.h} /></Control>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}

export function PosterEditorInspector(props: PosterEditorInspectorProps) {
  const tabs: readonly { id: PosterEditorPanel; label: string }[] = [
    { id: 'text', label: '文字' },
    { id: 'shape', label: '图形' },
    { id: 'image', label: '图片' },
  ]
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activateTab = (index: number) => {
    const nextIndex = (index + tabs.length) % tabs.length
    props.onPanel(tabs[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      activateTab(index + 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      activateTab(index - 1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      activateTab(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      activateTab(tabs.length - 1)
    }
  }
  return (
    <div className="poster-inspector">
      <div aria-label="编辑类别" aria-orientation="horizontal" className="poster-inspector__tabs" role="tablist">
        {tabs.map((tab, index) => (
          <button
            aria-controls={`poster-panel-${tab.id}`}
            aria-selected={props.panel === tab.id}
            className={props.panel === tab.id ? 'poster-inspector__tab poster-inspector__tab--active' : 'poster-inspector__tab'}
            id={`poster-tab-${tab.id}`}
            key={tab.id}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            onClick={() => props.onPanel(tab.id)}
            ref={(node) => { tabRefs.current[index] = node }}
            role="tab"
            tabIndex={props.panel === tab.id ? 0 : -1}
            type="button"
          >{tab.label}</button>
        ))}
      </div>
      <div aria-labelledby={`poster-tab-${props.panel}`} id={`poster-panel-${props.panel}`} role="tabpanel">
        {props.panel === 'text' ? <TextInspector layout={props.layout} selectedId={props.selectedTextId} copySnapshot={props.copySnapshot} busy={props.busy} onSelect={props.onSelectText} onLayout={props.onLayout} /> : null}
        {props.panel === 'shape' ? <ShapeInspector layout={props.layout} selectedId={props.selectedShapeId} busy={props.busy} onSelect={props.onSelectShape} onLayout={props.onLayout} /> : null}
        {props.panel === 'image' ? <ImageInspector layout={props.layout} selectedId={props.selectedImageId} imageStatus={props.imageStatus} busy={props.busy} onSelect={props.onSelectImage} onLayout={props.onLayout} onUpload={props.onUpload} onRemoveWhite={props.onRemoveWhite} /> : null}
      </div>
    </div>
  )
}

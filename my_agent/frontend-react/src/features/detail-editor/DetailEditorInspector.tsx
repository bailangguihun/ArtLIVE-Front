import type { ChangeEvent } from 'react'
import type {
  DetailEditorPanel,
  DetailPage,
  DetailResource,
  DetailShapeKind,
  DetailShapeLayer,
  DetailTextLayer,
} from '../../types/detail-editor'
import {
  DETAIL_BACKGROUNDS,
  DETAIL_FONTS,
  createShapeLayer,
  createTextLayer,
} from './detail-defaults'
import { DETAIL_IMAGE_ACCEPT } from './detail-resources'

interface MutationOptions {
  selectedLayerId?: string | null
  selectedResourceId?: string | null
}

interface DetailEditorInspectorProps {
  activePanel: DetailEditorPanel
  busy: boolean
  imageStatus: string
  page: DetailPage
  resources: Readonly<Record<string, DetailResource>>
  resourceUrls: Readonly<Record<string, string>>
  selectedLayerId: string | null
  selectedResourceId: string | null
  nextLayerSequence: number
  onBackground: (catalogId: string) => void
  onClearCustomBackground: () => void
  onCustomBackground: (file: File) => void
  onCutout: () => void
  onLibraryUpload: (file: File) => void
  onMutation: (page: DetailPage, options?: MutationOptions) => void
  onPanel: (panel: DetailEditorPanel) => void
  onPlaceResource: (resourceId: string) => void
  onRemoveResourcePlacement: (resourceId: string) => void
  onRemoveWhite: () => void
  onSelectResource: (resourceId: string) => void
  onUploadToCanvas: (file: File) => void
}

function selectedText(page: DetailPage, id: string | null) {
  const layer = page.layers.find((item) => item.id === id)
  return layer?.kind === 'text' ? layer : null
}

function selectedShape(page: DetailPage, id: string | null) {
  const layer = page.layers.find((item) => item.id === id)
  return layer?.kind === 'shape' ? layer : null
}

function fileFrom(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0] ?? null
  event.target.value = ''
  return file
}

export function DetailEditorInspector(props: DetailEditorInspectorProps) {
  const text = selectedText(props.page, props.selectedLayerId)
  const shape = selectedShape(props.page, props.selectedLayerId)
  const selectedResource = props.selectedResourceId ? props.resources[props.selectedResourceId] ?? null : null

  const updateText = (patch: Partial<DetailTextLayer>) => {
    if (!text) return
    props.onMutation({
      ...props.page,
      selectedFontId: patch.fontId ?? props.page.selectedFontId,
      layers: props.page.layers.map((item) => item.id === text.id ? { ...text, ...patch } : item),
    })
  }

  const updateShape = (patch: Partial<DetailShapeLayer>) => {
    if (!shape) return
    props.onMutation({
      ...props.page,
      layers: props.page.layers.map((item) => item.id === shape.id ? { ...shape, ...patch } : item),
    })
  }

  const addShape = (kind: DetailShapeKind) => {
    const layer = createShapeLayer(`shape-${props.nextLayerSequence}`, kind)
    props.onMutation({ ...props.page, layers: [...props.page.layers, layer] }, { selectedLayerId: layer.id })
  }

  const removeSelected = () => {
    if (!props.selectedLayerId) return
    props.onMutation(
      { ...props.page, layers: props.page.layers.filter((item) => item.id !== props.selectedLayerId) },
      { selectedLayerId: null },
    )
  }

  return (
    <aside className="detail-inspector" data-panel={props.activePanel}>
      <div aria-label="详情页编辑工具" className="detail-tool-tabs" role="tablist">
        {([
          ['background', '底图'],
          ['text', '文字'],
          ['shape', '图形'],
          ['image', '图片'],
        ] as const).map(([id, label]) => (
          <button
            aria-selected={props.activePanel === id}
            className={`detail-tool-tab detail-tool-tab--${id}`}
            disabled={props.busy}
            key={id}
            onClick={() => props.onPanel(id)}
            role="tab"
            type="button"
          >{label}</button>
        ))}
      </div>

      <div className="detail-inspector__scroll">
        <section className="detail-tool-panel detail-tool-panel--text" hidden={props.activePanel !== 'text'}>
          <button
            disabled={props.busy}
            onClick={() => {
              const layer = createTextLayer(`text-${props.nextLayerSequence}`, props.page.selectedFontId)
              props.onMutation({ ...props.page, layers: [...props.page.layers, layer] }, { selectedLayerId: layer.id })
            }}
            type="button"
          >添加文字</button>
          {text ? (
            <div className="detail-control-grid">
              <label className="detail-control-grid__wide">文案
                <textarea aria-label="文案" disabled={props.busy} onChange={(event) => updateText({ text: event.target.value })} value={text.text} />
              </label>
              <label className="detail-control-grid__wide">字体
                <select aria-label="字体" disabled={props.busy} onChange={(event) => updateText({ fontId: event.target.value })} value={text.fontId}>
                  {DETAIL_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
                </select>
              </label>
              <button aria-pressed={text.fontWeight === 'bold'} disabled={props.busy} onClick={() => updateText({ fontWeight: text.fontWeight === 'bold' ? 'normal' : 'bold' })} type="button">加粗</button>
              <button aria-pressed={text.fontStyle === 'italic'} disabled={props.busy} onClick={() => updateText({ fontStyle: text.fontStyle === 'italic' ? 'normal' : 'italic' })} type="button">倾斜</button>
              <label>字号<input aria-label="字号" disabled={props.busy} max="120" min="12" onChange={(event) => updateText({ fontSize: Number(event.target.value) })} step="1" type="number" value={text.fontSize} /></label>
              <label>填充<input aria-label="文字填充" disabled={props.busy} onChange={(event) => updateText({ fill: event.target.value })} type="color" value={text.fill} /></label>
              <label className="detail-checkbox detail-control-grid__wide"><input checked={text.strokeEnabled} disabled={props.busy} onChange={(event) => updateText({ strokeEnabled: event.target.checked })} type="checkbox" />启用描边</label>
              {text.strokeEnabled ? <>
                <label>描边色<input aria-label="描边色" disabled={props.busy} onChange={(event) => updateText({ stroke: event.target.value })} type="color" value={text.stroke} /></label>
                <label>粗细<input aria-label="描边粗细" disabled={props.busy} max="20" min="1" onChange={(event) => updateText({ strokeWidth: Number(event.target.value) })} step="1" type="number" value={text.strokeWidth} /></label>
              </> : null}
            </div>
          ) : <p>选择文字后可编辑属性。</p>}
        </section>

        <section className="detail-tool-panel detail-tool-panel--shape" hidden={props.activePanel !== 'shape'}>
          <div className="detail-shape-actions">
            {([['line', '直线'], ['rect', '矩形'], ['ellipse', '椭圆'], ['star', '五角星'], ['diamond', '菱形']] as const).map(([kind, label]) => (
              <button disabled={props.busy} key={kind} onClick={() => addShape(kind)} type="button">{label}</button>
            ))}
          </div>
          <button
            disabled={props.busy || !shape}
            onClick={() => {
              if (!shape) return
              const copy = { ...shape, id: `shape-${props.nextLayerSequence}`, left: shape.left + 24, top: shape.top + 24 }
              props.onMutation({ ...props.page, layers: [...props.page.layers, copy] }, { selectedLayerId: copy.id })
            }}
            type="button"
          >复制图形</button>
          {shape ? <div className="detail-control-grid">
            {shape.shapeKind !== 'line' ? <label>填充<input aria-label="图形填充" disabled={props.busy} onChange={(event) => updateShape({ fill: event.target.value })} type="color" value={shape.fill} /></label> : null}
            <label>描边<input aria-label="图形描边" disabled={props.busy} onChange={(event) => updateShape({ stroke: event.target.value })} type="color" value={shape.stroke} /></label>
          </div> : null}
        </section>

        <section className="detail-tool-panel detail-tool-panel--image" hidden={props.activePanel !== 'image'}>
          <label className="detail-file-control">上传图片
            <input accept={DETAIL_IMAGE_ACCEPT} disabled={props.busy} onChange={(event) => { const file = fileFrom(event); if (file) props.onUploadToCanvas(file) }} type="file" />
          </label>
          <div className="detail-image-actions">
            <button disabled={props.busy || !selectedResource} onClick={props.onCutout} type="button">去除背景</button>
            <button disabled={props.busy || !selectedResource} onClick={props.onRemoveWhite} type="button">去除白底</button>
          </div>
        </section>

        <section className="detail-backgrounds">
          <h2>系统底图</h2>
          <div className="detail-background-grid">
            {DETAIL_BACKGROUNDS.map((background) => {
              const selected = props.page.background.kind === 'system' && props.page.background.catalogId === background.id
              return <button aria-pressed={selected} disabled={props.busy} key={background.id} onClick={() => props.onBackground(background.id)} type="button">
                <img alt="" height="64" src={background.url} width="36" />
                <span>{background.label}</span><small>{selected ? '已选' : '选用'}</small>
              </button>
            })}
          </div>
          <div className="detail-custom-background">
            <h2>自定义底图</h2>
            <label className="detail-file-control">底图文件
              <input accept={DETAIL_IMAGE_ACCEPT} disabled={props.busy} onChange={(event) => { const file = fileFrom(event); if (file) props.onCustomBackground(file) }} type="file" />
            </label>
            <button disabled={props.busy || props.page.background.kind !== 'custom'} onClick={props.onClearCustomBackground} type="button">清除自定义底图</button>
          </div>
        </section>

        <section className="detail-product-library">
          <h2>产品海报库</h2>
          <label className="detail-file-control">追加上传图片
            <input accept={DETAIL_IMAGE_ACCEPT} disabled={props.busy} onChange={(event) => { const file = fileFrom(event); if (file) props.onLibraryUpload(file) }} type="file" />
          </label>
          <div className="detail-mobile-image-actions">
            <button disabled={props.busy || !selectedResource} onClick={props.onCutout} type="button">去除背景</button>
            <button disabled={props.busy || !selectedResource} onClick={props.onRemoveWhite} type="button">去除白底</button>
          </div>
          <div className="detail-product-list">
            {Object.values(props.resources).filter((resource) => resource.kind !== 'custom-background').map((resource) => {
              const placed = props.page.layers.some((layer) => layer.kind === 'image' && layer.resourceId === resource.id)
              const selected = props.selectedResourceId === resource.id
              return <article className={selected ? 'detail-product detail-product--selected' : 'detail-product'} key={resource.id}>
                {props.resourceUrls[resource.id] ? <img alt="" src={props.resourceUrls[resource.id]} /> : null}
                <button aria-pressed={selected} disabled={props.busy} onClick={() => props.onSelectResource(resource.id)} type="button">{resource.id === 'poster-final' ? '定稿海报' : resource.name}</button>
                <button disabled={props.busy} onClick={() => placed ? props.onRemoveResourcePlacement(resource.id) : props.onPlaceResource(resource.id)} type="button">{placed ? '移出画布' : '放到画布'}</button>
              </article>
            })}
          </div>
          {Object.values(props.resources).filter((resource) => resource.kind !== 'custom-background').length === 0 ? <p>暂无图片，请在画布「图片」工具栏上传，或使用上方追加上传。</p> : null}
          {props.imageStatus ? <p aria-live="polite" className="detail-image-status">{props.imageStatus}</p> : null}
        </section>

        <div className="detail-object-actions">
          <button disabled={props.busy || !props.selectedLayerId} onClick={removeSelected} type="button">删除选中</button>
          <button disabled={props.busy || props.page.layers.length === 0} onClick={() => props.onMutation({ ...props.page, layers: [] }, { selectedLayerId: null })} type="button">清空画布</button>
        </div>
      </div>
    </aside>
  )
}

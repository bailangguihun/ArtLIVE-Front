import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreationHistoryBatch,
  CreationHistoryImage,
  CreationHistoryListItem,
} from './creation-history-types'

const storeMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('./creation-history-store', () => ({
  listCreationHistoryBatches: storeMocks.list,
  getCreationHistoryBatch: storeMocks.get,
  deleteCreationHistoryBatch: storeMocks.remove,
}))

import { CreationHistoryView } from './CreationHistoryView'

const hash = (character: string) => character.repeat(64)

function image(
  kind: 'poster' | 'detail',
  ordinal: number,
  bytes: readonly number[],
): CreationHistoryImage {
  const poster = kind === 'poster'
  return {
    kind,
    title: poster ? '海报设计' : `详情页 ${ordinal}`,
    fileName: poster ? 'confirmed-poster.png' : `confirmed-detail-${ordinal}.png`,
    ordinal,
    width: poster ? 1024 : 750,
    height: poster ? 1536 : 1334,
    sha256: hash(poster ? 'a' : String(ordinal)),
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
  }
}

function batch(options: {
  id: string
  epoch: number
  updatedAt: number
  copyBody?: string | null
  poster?: CreationHistoryImage | null
  details?: readonly CreationHistoryImage[]
}): CreationHistoryBatch {
  return {
    id: options.id,
    epoch: options.epoch,
    updatedAt: options.updatedAt,
    productShortName: `商品 ${options.epoch}`,
    productInfo: `第 ${options.epoch} 批商品`,
    platform: 'xiaohongshu',
    style: 'premium',
    strategyName: '功能价值与场景证明',
    copy: options.copyBody === null ? null : {
      body: options.copyBody ?? `第 ${options.epoch} 批文案`,
      title: '标题',
      headline: '主标题',
      subline: '副标题',
      platform: 'xiaohongshu',
      style: 'premium',
      outputSignatureSha256: hash('c'),
    },
    poster: options.poster ?? null,
    details: options.details ?? [],
  }
}

function listItem(value: CreationHistoryBatch): CreationHistoryListItem {
  return {
    id: value.id,
    epoch: value.epoch,
    updatedAt: value.updatedAt,
    productShortName: value.productShortName,
    productInfo: value.productInfo,
    platform: value.platform,
    style: value.style,
    hasCopy: Boolean(value.copy),
    hasPoster: Boolean(value.poster),
    detailCount: value.details.length,
    thumbnail: value.poster ?? value.details[0] ?? null,
  }
}

function installStore(records: CreationHistoryBatch[]) {
  let current = [...records]
  const byId = new Map(current.map((record) => [record.id, record]))
  storeMocks.list.mockImplementation(async () => current.map(listItem))
  storeMocks.get.mockImplementation(async (id: string) => byId.get(id) ?? null)
  storeMocks.remove.mockImplementation(async (id: string) => {
    byId.delete(id)
    current = current.filter((record) => record.id !== id)
  })
  return {
    records: () => current,
    batch: (id: string) => byId.get(id),
  }
}

function installObjectUrlCapture() {
  const blobByUrl = new Map<string, Blob>()
  const revoked: string[] = []
  const downloads: Array<{ fileName: string; blob: Blob | undefined }> = []
  let sequence = 0
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:history-round5-${++sequence}`
      blobByUrl.set(url, blob)
      return url
    }),
    revokeObjectURL: vi.fn((url: string) => { revoked.push(url) }),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(this: HTMLAnchorElement) {
    const href = this.getAttribute('href') ?? ''
    downloads.push({ fileName: this.download, blob: blobByUrl.get(href) })
  })
  return { blobByUrl, revoked, downloads }
}

beforeEach(() => {
  storeMocks.list.mockReset()
  storeMocks.get.mockReset()
  storeMocks.remove.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreationHistoryView', () => {
  it('shows loading, then the existing empty state, focuses the heading, and returns Home', async () => {
    let resolveList!: (rows: readonly CreationHistoryListItem[]) => void
    storeMocks.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve }))
    const onBackHome = vi.fn()
    const user = userEvent.setup()
    render(<CreationHistoryView onBackHome={onBackHome} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在加载历史记录…')
    resolveList([])
    expect(await screen.findByLabelText('暂无历史记录')).toBeVisible()
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: '历史记录' }),
    ))
    await user.click(screen.getByRole('button', { name: '返回首页' }))
    expect(onBackHome).toHaveBeenCalledTimes(1)
  })

  it('preserves the existing store-error alert without inventing retry or toast behavior', async () => {
    storeMocks.list.mockRejectedValue(new Error('fixture store failure'))
    render(<CreationHistoryView onBackHome={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('历史记录加载失败，请稍后重试。')
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
  })

  it('keeps supplied archive ordering, summaries, detail/back behavior, and destructive hooks', async () => {
    const newer = batch({
      id: 'session-2', epoch: 2, updatedAt: 200,
      poster: image('poster', 1, [2]), details: [image('detail', 1, [3])],
    })
    const older = batch({ id: 'session-1', epoch: 1, updatedAt: 100, poster: null, details: [] })
    installStore([newer, older])
    const user = userEvent.setup()
    render(<CreationHistoryView onBackHome={vi.fn()} />)

    const cardHeadings = await screen.findAllByRole('heading', { level: 2 })
    expect(cardHeadings.map((heading) => heading.textContent)).toEqual(['商品 2', '商品 1'])
    expect(screen.getByText('文案 · 海报 · 详情页 × 1')).toBeVisible()
    const listDeletes = screen.getAllByRole('button', { name: '删除' })
    expect(listDeletes).toHaveLength(2)
    expect(listDeletes.every((button) => button.getAttribute('data-action') === 'destructive')).toBe(true)

    await user.click(screen.getAllByRole('button', { name: '查看详情' })[0])
    expect(storeMocks.get).toHaveBeenCalledWith('session-2')
    expect(await screen.findByRole('heading', { name: '海报设计' })).toBeVisible()
    expect(screen.getByRole('button', { name: '删除这条记录' })).toHaveAttribute(
      'data-action', 'destructive',
    )
    await user.click(screen.getByRole('button', { name: '返回列表' }))
    expect(await screen.findByRole('heading', { name: '商品 2' })).toBeVisible()
  })

  it('preserves preview/download Blob identity, filenames, text whitespace, and URL revocation', async () => {
    const body = '归档首行  保留\r\n\r\n归档末行尾随两个空格  '
    const poster = image('poster', 1, [1, 2, 3])
    const details = [image('detail', 1, [4, 5]), image('detail', 2, [6, 7])]
    const record = batch({ id: 'session-1', epoch: 1, updatedAt: 100, copyBody: body, poster, details })
    installStore([record])
    const capture = installObjectUrlCapture()
    const user = userEvent.setup()
    const rendered = render(<CreationHistoryView onBackHome={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: '查看详情' }))
    expect(await screen.findByRole('heading', { name: '推广文案' })).toBeVisible()
    expect(document.querySelector('.creation-history__copy')?.textContent).toBe(body)
    expect([...capture.blobByUrl.values()]).toEqual(expect.arrayContaining([
      poster.blob, details[0].blob, details[1].blob,
    ]))

    await user.click(screen.getByRole('button', { name: '下载海报' }))
    await user.click(screen.getByRole('button', { name: '下载文案' }))
    await user.click(screen.getByRole('button', { name: '按顺序下载详情页' }))
    expect(capture.downloads.map((item) => ({ fileName: item.fileName, blob: item.blob }))).toEqual([
      { fileName: 'confirmed-poster.png', blob: poster.blob },
      { fileName: 'history-promotional-copy.txt', blob: expect.any(Blob) },
      { fileName: 'confirmed-detail-1.png', blob: details[0].blob },
      { fileName: 'confirmed-detail-2.png', blob: details[1].blob },
    ])
    expect(capture.downloads[1].blob?.type).toBe('text/plain;charset=utf-8')
    expect(await capture.downloads[1].blob?.text()).toBe(body)
    expect(Array.from(new Uint8Array(await capture.downloads[1].blob!.arrayBuffer()))).toEqual(
      Array.from(new TextEncoder().encode(body)),
    )

    await user.click(screen.getByRole('button', { name: '返回列表' }))
    rendered.unmount()
    for (const url of capture.blobByUrl.keys()) {
      expect(capture.revoked.filter((item) => item === url)).toHaveLength(1)
    }
  })

  it('deletes one unselected archive while keeping the remaining payload and Blob unchanged across remount', async () => {
    const poster = image('poster', 1, [8, 9])
    const remaining = batch({ id: 'session-2', epoch: 2, updatedAt: 200, poster, details: [] })
    const deleted = batch({ id: 'session-1', epoch: 1, updatedAt: 100, poster: null, details: [] })
    const memory = installStore([remaining, deleted])
    const capture = installObjectUrlCapture()
    const user = userEvent.setup()
    const first = render(<CreationHistoryView onBackHome={vi.fn()} />)

    const deleteButtons = await screen.findAllByRole('button', { name: '删除' })
    await user.click(deleteButtons[1])
    await waitFor(() => expect(screen.queryByRole('heading', { name: '商品 1' })).not.toBeInTheDocument())
    expect(storeMocks.remove).toHaveBeenCalledWith('session-1')
    expect(memory.records()).toEqual([remaining])
    expect(memory.batch('session-2')?.poster?.blob).toBe(poster.blob)
    first.unmount()

    render(<CreationHistoryView onBackHome={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: '查看详情' }))
    await user.click(await screen.findByRole('button', { name: '下载海报' }))
    expect(capture.downloads.at(-1)).toEqual({
      fileName: 'confirmed-poster.png', blob: poster.blob,
    })
  })

  it('deletes the selected archive, revokes its previews, and returns to the untouched remaining list', async () => {
    const selectedPoster = image('poster', 1, [1, 1])
    const selected = batch({ id: 'session-2', epoch: 2, updatedAt: 200, poster: selectedPoster })
    const remaining = batch({ id: 'session-1', epoch: 1, updatedAt: 100, poster: null, details: [] })
    const memory = installStore([selected, remaining])
    const capture = installObjectUrlCapture()
    const user = userEvent.setup()
    render(<CreationHistoryView onBackHome={vi.fn()} />)

    await user.click((await screen.findAllByRole('button', { name: '查看详情' }))[0])
    await screen.findByRole('heading', { name: '海报设计' })
    const previewUrls = [...capture.blobByUrl.entries()]
      .filter(([, blob]) => blob === selectedPoster.blob)
      .map(([url]) => url)
    await user.click(screen.getByRole('button', { name: '删除这条记录' }))
    expect(await screen.findByRole('heading', { name: '商品 1' })).toBeVisible()
    expect(storeMocks.remove).toHaveBeenCalledWith('session-2')
    expect(memory.records()).toEqual([remaining])
    expect(previewUrls.some((url) => capture.revoked.includes(url))).toBe(true)
  })

  it('deletes the final archive into the existing empty state without confirmation or toast', async () => {
    const only = batch({ id: 'session-1', epoch: 1, updatedAt: 100, poster: null, details: [] })
    installStore([only])
    const user = userEvent.setup()
    render(<CreationHistoryView onBackHome={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: '删除' }))
    expect(await screen.findByLabelText('暂无历史记录')).toBeVisible()
    expect(storeMocks.remove).toHaveBeenCalledWith('session-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

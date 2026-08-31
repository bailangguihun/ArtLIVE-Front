import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowState } from '../../state/use-workflow'
import { PRODUCT_INFO_REQUIRED_MESSAGE } from './validation'

const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

function WorkflowStateProbe() {
  const state = useWorkflowState()
  return (
    <output data-testid="workflow-state">
      {JSON.stringify({
        completedSteps: [...state.completedSteps],
        currentImageName: state.productInfo.productImage?.name ?? null,
        completedDraft: state.productInfo.completedDraft
          ? {
              productInfo: state.productInfo.completedDraft.productInfo,
              productShortName:
                state.productInfo.completedDraft.productShortName,
              creativeNote: state.productInfo.completedDraft.creativeNote,
              imageName:
                state.productInfo.completedDraft.productImage?.name ?? null,
            }
          : null,
      })}
    </output>
  )
}

function renderApp({ withProbe = false } = {}) {
  const result = render(
    <WorkflowProvider>
      <App />
      {withProbe ? <WorkflowStateProbe /> : null}
    </WorkflowProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '开始新创作' }))
  return result
}

describe('ProductInfoStep', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline test double')))
    createObjectURL.mockReset()
    revokeObjectURL.mockReset()
    createObjectURL
      .mockReturnValueOnce('blob:product-preview-one')
      .mockReturnValueOnce('blob:product-preview-two')

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  it('shows the required Product Information validation', () => {
    renderApp()

    expect(screen.getByLabelText('产品信息')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText(PRODUCT_INFO_REQUIRED_MESSAGE)).toBeVisible()
  })

  it('blocks continuation until Product Information is non-blank', async () => {
    const user = userEvent.setup()
    renderApp()
    const nextButton = screen.getByRole('button', { name: '下一步' })

    expect(nextButton).toBeDisabled()
    await user.type(screen.getByLabelText('产品信息'), '   ')
    expect(nextButton).toBeDisabled()
    await user.type(screen.getByLabelText('产品信息'), '新品口红')
    expect(nextButton).toBeEnabled()
  })

  it('uses the V2 Basic heading while retaining the Product Information field label', () => {
    renderApp()

    expect(screen.getByRole('heading', { name: '01 基本信息' })).toBeVisible()
    expect(screen.getByLabelText('产品信息')).toBeVisible()
    expect(screen.getByRole('button', { name: '返回首页' })).toBeVisible()
  })

  it('returns Home through the central SPA navigation without losing a compatible Basic draft', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/')
    const pushState = vi.spyOn(window.history, 'pushState')
    renderApp()
    const productInfo = screen.getByLabelText('产品信息')
    await user.type(productInfo, '保留在同一轮创作中的基本信息草稿')
    const apiCallsBeforeHome = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    const pushesBeforeHome = pushState.mock.calls.length

    await user.click(screen.getByRole('button', { name: '返回首页' }))

    expect(await screen.findByRole('button', { name: '继续本轮创作' })).toBeVisible()
    expect(window.location.pathname).toBe('/')
    expect(pushState).toHaveBeenCalledTimes(pushesBeforeHome + 1)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(apiCallsBeforeHome)

    const pushesBeforeContinue = pushState.mock.calls.length
    await user.click(screen.getByRole('button', { name: '继续本轮创作' }))

    expect(await screen.findByRole('heading', { name: '01 基本信息' })).toBeVisible()
    expect(window.location.pathname).toBe('/basic')
    expect(pushState).toHaveBeenCalledTimes(pushesBeforeContinue + 1)
    expect(screen.getByLabelText('产品信息')).toHaveValue('保留在同一轮创作中的基本信息草稿')
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(apiCallsBeforeHome)
    pushState.mockRestore()
  })

  it('selects one accepted product image and renders a local preview', async () => {
    const user = userEvent.setup()
    renderApp()
    const file = new File(['first-image'], 'lipstick.png', {
      type: 'image/png',
    })

    await user.upload(screen.getByLabelText(/商品参考图上传 选择图片/), file)

    expect(screen.getByText('已选择：lipstick.png')).toBeVisible()
    expect(
      screen.getByRole('img', { name: '商品参考图预览：lipstick.png' }),
    ).toHaveAttribute('src', 'blob:product-preview-one')
    expect(createObjectURL).toHaveBeenCalledWith(file)
  })

  it('replaces the selected image and revokes the old preview URL', async () => {
    const user = userEvent.setup()
    renderApp()
    const firstFile = new File(['first-image'], 'first.png', {
      type: 'image/png',
    })
    const secondFile = new File(['second-image'], 'second.webp', {
      type: 'image/webp',
    })

    await user.upload(screen.getByLabelText(/商品参考图上传 选择图片/), firstFile)
    await user.upload(
      screen.getByLabelText(/商品参考图上传 替换图片/),
      secondFile,
    )

    expect(screen.getByText('已选择：second.webp')).toBeVisible()
    expect(screen.queryByText('已选择：first.png')).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:product-preview-one')
  })

  it('removes the selected image, clears its bytes, and revokes its URL', async () => {
    const user = userEvent.setup()
    renderApp({ withProbe: true })
    const file = new File(['first-image'], 'remove-me.jpg', {
      type: 'image/jpeg',
    })

    await user.upload(screen.getByLabelText(/商品参考图上传 选择图片/), file)
    await user.click(screen.getByRole('button', { name: '移除图片' }))

    expect(
      screen.getByText('上传后预览图会显示在此处（居中）。'),
    ).toBeVisible()
    expect(screen.queryByText('已选择：remove-me.jpg')).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:product-preview-one')
    expect(JSON.parse(screen.getByTestId('workflow-state').textContent ?? '')).toEqual(
      {
        completedSteps: [],
        currentImageName: null,
        completedDraft: null,
      },
    )
  })

  it('revokes the active preview URL when the upload field unmounts', async () => {
    const user = userEvent.setup()
    const view = renderApp()
    const file = new File(['unmount-image'], 'unmount.png', {
      type: 'image/png',
    })

    await user.upload(screen.getByLabelText(/商品参考图上传 选择图片/), file)
    view.unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:product-preview-one')
  })

  it('stores a typed Step 1 draft and marks Step 1 complete locally', async () => {
    const user = userEvent.setup()
    renderApp({ withProbe: true })
    const image = new File(['draft-image'], 'draft.webp', {
      type: 'image/webp',
    })

    await user.type(screen.getByLabelText('产品信息'), '丝绒质感哑光口红')
    await user.upload(screen.getByLabelText(/商品参考图上传 选择图片/), image)
    await user.click(screen.getByRole('button', { name: '下一步' }))

    // Step 1 commits only after its real byte-hash ownership check completes.
    // The Advice error view is the user-visible transition that proves that
    // guarded commit, without relying on a synchronous post-click read.
    expect(
      await screen.findByRole('heading', { name: '营销建议生成失败' }),
    ).toBeVisible()

    expect(JSON.parse(screen.getByTestId('workflow-state').textContent ?? '')).toEqual(
      {
        completedSteps: [1],
        currentImageName: 'draft.webp',
        completedDraft: {
          productInfo: '丝绒质感哑光口红',
          productShortName: '',
          creativeNote: '',
          imageName: 'draft.webp',
        },
      },
    )
  })
})

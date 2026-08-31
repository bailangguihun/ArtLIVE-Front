import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach } from 'vitest'

const BrowserBlob = globalThis.Blob
const { Blob: NodeBlob } = await import('node:' + 'buffer') as {
  Blob: typeof Blob
}
const browserBlobImplementationKey = Reflect.ownKeys(new BrowserBlob())
  .find((key) => typeof key === 'symbol' && key.description === 'impl')

if (!browserBlobImplementationKey) {
  throw new Error('The jsdom Blob implementation key is unavailable')
}
const browserBlobImplementationSymbol = browserBlobImplementationKey

class StructuredCloneCompatibleBlob extends NodeBlob {
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof NodeBlob || value instanceof BrowserBlob
  }

  constructor(blobParts: BlobPart[] = [], options: BlobPropertyBag = {}) {
    super(blobParts, options)
    const browserBlob = new BrowserBlob(blobParts, options)
    Object.defineProperty(this, browserBlobImplementationSymbol, {
      value: Reflect.get(browserBlob, browserBlobImplementationSymbol),
    })
  }
}

Object.defineProperty(globalThis, 'Blob', {
  configurable: true,
  value: StructuredCloneCompatibleBlob,
  writable: true,
})

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

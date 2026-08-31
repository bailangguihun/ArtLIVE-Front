import {
  CREATION_HISTORY_LIMIT,
  type CreationHistoryBatch,
  type CreationHistoryListItem,
} from './creation-history-types'

const DB_NAME = 'creation-history-v1'
const STORE_NAME = 'batches'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('无法打开历史记录数据库'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('历史记录读写失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('历史记录事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('历史记录事务中止'))
  })
}

export function batchIdForEpoch(epoch: number): string {
  return `session-${epoch}`
}

export function toHistoryListItem(batch: CreationHistoryBatch): CreationHistoryListItem {
  return {
    id: batch.id,
    epoch: batch.epoch,
    updatedAt: batch.updatedAt,
    productShortName: batch.productShortName,
    productInfo: batch.productInfo,
    platform: batch.platform,
    style: batch.style,
    hasCopy: Boolean(batch.copy),
    hasPoster: Boolean(batch.poster),
    detailCount: batch.details.length,
    thumbnail: batch.poster ?? batch.details[0] ?? null,
  }
}

export async function upsertCreationHistoryBatch(
  batch: CreationHistoryBatch,
): Promise<void> {
  const db = await openDb()
  try {
    const write = db.transaction(STORE_NAME, 'readwrite')
    write.objectStore(STORE_NAME).put(batch)
    await transactionDone(write)

    const read = db.transaction(STORE_NAME, 'readonly')
    const all = await requestToPromise(
      read.objectStore(STORE_NAME).index('updatedAt').getAll(),
    )
    await transactionDone(read)

    if (all.length <= CREATION_HISTORY_LIMIT) return

    const overflow = [...all]
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(0, all.length - CREATION_HISTORY_LIMIT)
    const purge = db.transaction(STORE_NAME, 'readwrite')
    const store = purge.objectStore(STORE_NAME)
    for (const item of overflow) store.delete(item.id)
    await transactionDone(purge)
  } finally {
    db.close()
  }
}

export async function listCreationHistoryBatches(): Promise<CreationHistoryListItem[]> {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const rows = await requestToPromise(
      transaction.objectStore(STORE_NAME).index('updatedAt').getAll(),
    )
    await transactionDone(transaction)
    return [...rows]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(toHistoryListItem)
  } finally {
    db.close()
  }
}

export async function getCreationHistoryBatch(
  id: string,
): Promise<CreationHistoryBatch | null> {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const row = await requestToPromise(transaction.objectStore(STORE_NAME).get(id))
    await transactionDone(transaction)
    return row ?? null
  } finally {
    db.close()
  }
}

export async function deleteCreationHistoryBatch(id: string): Promise<void> {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    await transactionDone(transaction)
  } finally {
    db.close()
  }
}

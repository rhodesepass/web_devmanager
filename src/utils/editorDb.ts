import type { AssetMeta } from '@/editor-core/model'

/**
 * 编辑器 IndexedDB 持久化层（纯存取，无业务逻辑）。
 * store 'assets'：key = assetId，value = { meta, file }（File 直接结构化克隆入库，保 name/type）
 * store 'project'：key = 'current'，value = serializeProject 产物字符串
 */

const DB_NAME = 'epass-editor'
const DB_VERSION = 1
const STORE_ASSETS = 'assets'
const STORE_PROJECT = 'project'
const PROJECT_KEY = 'current'

export interface StoredAsset {
  meta: AssetMeta
  file: File
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb (): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS)
      }
      if (!db.objectStoreNames.contains(STORE_PROJECT)) {
        db.createObjectStore(STORE_PROJECT)
      }
    }
    req.addEventListener('success', () => {
      // 版本冲突（其他标签页升级）时失效缓存，下次重开
      req.result.addEventListener('versionchange', () => {
        req.result.close()
        dbPromise = null
      })
      resolve(req.result)
    })
    req.addEventListener('error', () => {
      dbPromise = null
      reject(req.error ?? new Error('IndexedDB 打开失败'))
    })
  })
  return dbPromise
}

function requestAsPromise<T> (req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener('success', () => resolve(req.result))
    req.addEventListener('error', () => reject(req.error ?? new Error('IndexedDB 操作失败')))
  })
}

async function withStore<T> (
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return requestAsPromise(fn(db.transaction(storeName, mode).objectStore(storeName)))
}

export async function saveAsset (meta: AssetMeta, file: File): Promise<void> {
  await withStore(STORE_ASSETS, 'readwrite', s => s.put({ meta, file } satisfies StoredAsset, meta.id))
}

export async function deleteAsset (id: string): Promise<void> {
  await withStore(STORE_ASSETS, 'readwrite', s => s.delete(id))
}

export async function loadAllAssets (): Promise<Map<string, StoredAsset>> {
  const db = await openDb()
  const store = db.transaction(STORE_ASSETS, 'readonly').objectStore(STORE_ASSETS)
  const [keys, values] = await Promise.all([
    requestAsPromise(store.getAllKeys()),
    requestAsPromise(store.getAll() as IDBRequest<StoredAsset[]>),
  ])
  const out = new Map<string, StoredAsset>()
  for (const [i, key] of keys.entries()) {
    out.set(String(key), values[i])
  }
  return out
}

export async function saveProjectJson (text: string): Promise<void> {
  await withStore(STORE_PROJECT, 'readwrite', s => s.put(text, PROJECT_KEY))
}

export async function loadProjectJson (): Promise<string | null> {
  const v = await withStore<unknown>(STORE_PROJECT, 'readonly', s => s.get(PROJECT_KEY))
  return typeof v === 'string' ? v : null
}

export async function deleteProjectJson (): Promise<void> {
  await withStore(STORE_PROJECT, 'readwrite', s => s.delete(PROJECT_KEY))
}

/** 新建工程语义：两个 store 全清 */
export async function clearEditorDb (): Promise<void> {
  await Promise.all([
    withStore(STORE_ASSETS, 'readwrite', s => s.clear()),
    withStore(STORE_PROJECT, 'readwrite', s => s.clear()),
  ])
}

export async function estimateUsage (): Promise<{ usageBytes: number, quotaBytes: number } | null> {
  if (!navigator.storage?.estimate) {
    return null
  }
  try {
    const { usage, quota } = await navigator.storage.estimate()
    return { usageBytes: usage ?? 0, quotaBytes: quota ?? 0 }
  } catch {
    return null
  }
}

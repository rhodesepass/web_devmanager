import { computed, ref } from 'vue'

export interface TransferLockSnapshot {
  title: string
  detail: string | null
  bytes: number
  total: number
}

const lock = ref<TransferLockSnapshot | null>(null)

export function useTransferLock () {
  const active = computed(() => lock.value != null)

  const percent = computed(() => {
    const s = lock.value
    if (!s || s.total <= 0) {
      return null
    }
    return Math.min(100, Math.round((s.bytes / s.total) * 100))
  })

  function begin (title: string, detail: string | null = null) {
    lock.value = { title, detail, bytes: 0, total: 0 }
  }

  function update (
    detail?: string | null,
    bytes?: number,
    total?: number,
  ) {
    if (!lock.value) {
      return
    }
    if (detail !== undefined) {
      lock.value.detail = detail
    }
    if (bytes !== undefined) {
      lock.value.bytes = bytes
    }
    if (total !== undefined) {
      lock.value.total = total
    }
  }

  function end () {
    lock.value = null
  }

  return { lock, active, percent, begin, update, end }
}

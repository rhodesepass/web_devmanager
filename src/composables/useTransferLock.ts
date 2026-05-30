import { computed, ref } from 'vue'

export interface TransferLockSnapshot {
  title: string
  detail: string | null
  bytes: number
  total: number
  /** 为 false 时仅禁止侧栏/路由切换，不显示全屏遮罩（如等待 WebUSB 授权） */
  overlay: boolean
}

export interface TransferLockBeginOptions {
  overlay?: boolean
}

const lock = ref<TransferLockSnapshot | null>(null)

export function useTransferLock () {
  const active = computed(() => lock.value != null)

  const showOverlay = computed(
    () => lock.value != null && lock.value.overlay,
  )

  const percent = computed(() => {
    const s = lock.value
    if (!s || s.total <= 0) {
      return null
    }
    return Math.min(100, Math.round((s.bytes / s.total) * 100))
  })

  function begin (
    title: string,
    detail: string | null = null,
    options: TransferLockBeginOptions = {},
  ) {
    lock.value = {
      title,
      detail,
      bytes: 0,
      total: 0,
      overlay: options.overlay ?? true,
    }
  }

  function setOverlay (overlay: boolean) {
    if (!lock.value) {
      return
    }
    lock.value.overlay = overlay
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

  return { lock, active, showOverlay, percent, begin, setOverlay, update, end }
}

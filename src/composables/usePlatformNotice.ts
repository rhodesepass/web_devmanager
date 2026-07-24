import { onMounted, ref } from 'vue'
import {
  getPlatformNoticeKind,
  isWebUsbSupported,
  type PlatformNoticeKind,
} from '@/utils/browser'

const SESSION_KEY = 'epass-platform-notice-dismissed'

// 模块级单例,让任意页面都能主动弹出用户须知(如系统测试的「重新安装驱动」按钮)
const show = ref(false)
const kind = ref<PlatformNoticeKind | null>(null)

function resolveAutoKind (): PlatformNoticeKind | null {
  const platformKind = getPlatformNoticeKind()
  if (platformKind) {
    return platformKind
  }
  // 无平台专属须知（如 macOS）时，若不支持 WebUSB 再提示离线刷机
  if (!isWebUsbSupported()) {
    return 'nowebusb'
  }
  return null
}

function open (forceKind?: PlatformNoticeKind) {
  kind.value = forceKind ?? getPlatformNoticeKind() ?? 'windows'
  show.value = true
}

function dismiss () {
  sessionStorage.setItem(SESSION_KEY, '1')
  show.value = false
}

export function usePlatformNotice (skip = false) {
  onMounted(() => {
    if (skip) {
      return
    }
    if (sessionStorage.getItem(SESSION_KEY)) {
      return
    }
    const autoKind = resolveAutoKind()
    if (!autoKind) {
      return
    }
    kind.value = autoKind
    show.value = true
  })

  return { show, kind, dismiss, open }
}

import { onMounted, ref } from 'vue'
import { getPlatformNoticeKind, type PlatformNoticeKind } from '@/utils/browser'

const SESSION_KEY = 'epass-platform-notice-dismissed'

// 模块级单例,让任意页面都能主动弹出用户须知(如系统测试的「重新安装驱动」按钮)
const show = ref(false)
const kind = ref<PlatformNoticeKind | null>(null)

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
    const platformKind = getPlatformNoticeKind()
    if (!platformKind) {
      return
    }
    if (sessionStorage.getItem(SESSION_KEY)) {
      return
    }
    kind.value = platformKind
    show.value = true
  })

  return { show, kind, dismiss, open }
}

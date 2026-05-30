import { onMounted, ref } from 'vue'
import { getPlatformNoticeKind, type PlatformNoticeKind } from '@/utils/browser'

const SESSION_KEY = 'epass-platform-notice-dismissed'

export function usePlatformNotice (skip = false) {
  const show = ref(false)
  const kind = ref<PlatformNoticeKind | null>(null)

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

  function dismiss () {
    sessionStorage.setItem(SESSION_KEY, '1')
    show.value = false
  }

  return { show, kind, dismiss }
}

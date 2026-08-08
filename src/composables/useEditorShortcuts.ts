import { ref } from 'vue'
import { isEditableTarget } from '@/components/editor/uiUtils'
import { clipEndUs } from '@/editor-core/model'
import { useEditorPlayback } from './useEditorPlayback'
import { useEditorProject } from './useEditorProject'
import { useTimelineViewport } from './useTimelineViewport'

/**
 * 全屏 NLE 的快捷键（editorCut.vue mount 时 attach）。
 *
 * Space 双语义靠 keyup 裁决：按住 + 画布拖动 = 平移（EditorCanvas 消费 spaceHeld，
 * 平移一旦发生调 markPanOccurred），松键时没发生过平移才当作播放/暂停敲击。
 */

const spaceHeld = ref(false)
let panOccurred = false

export function useEditorShortcuts () {
  const {
    project,
    activeSegmentDurationUs,
    selectedClipId,
    selectedClip,
    removeClip,
    duplicateClip,
    resizeClip,
    splitAtPlayheadUs,
  } = useEditorProject()
  const { playheadUs, toggle, seek } = useEditorPlayback()
  const { zoomBy, toolMode } = useTimelineViewport()

  function markPanOccurred () {
    panOccurred = true
  }

  /** 播放头跳转类按键；命中返回 true */
  function handleSeekKeys (event: KeyboardEvent): boolean {
    switch (event.code) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const frameUs = Math.round(1_000_000 / project.value.fps)
        const step = (event.shiftKey ? 1_000_000 : frameUs) * (event.code === 'ArrowLeft' ? -1 : 1)
        seek(playheadUs.value + step)
        return true
      }
      case 'Home': {
        seek(0)
        return true
      }
      case 'End': {
        seek(activeSegmentDurationUs.value)
        return true
      }
      default: {
        return false
      }
    }
  }

  /** V/B/R 切时间轴工具；命中返回 true */
  function handleToolKeys (event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey) {
      return false
    }
    switch (event.code) {
      case 'KeyV': {
        toolMode.value = 'select'
        return true
      }
      case 'KeyB': {
        toolMode.value = 'razor'
        return true
      }
      case 'KeyR': {
        toolMode.value = 'stretch'
        return true
      }
      default: {
        return false
      }
    }
  }

  function onKeyDown (event: KeyboardEvent) {
    if (isEditableTarget(event.target)) {
      return
    }
    if (handleSeekKeys(event)) {
      event.preventDefault()
      return
    }
    if (handleToolKeys(event)) {
      return
    }
    switch (event.code) {
      case 'Space': {
        event.preventDefault()
        if (!event.repeat && !spaceHeld.value) {
          spaceHeld.value = true
          panOccurred = false
        }
        break
      }
      case 'KeyC': {
        if (!event.ctrlKey && !event.metaKey && !event.repeat) {
          splitAtPlayheadUs(playheadUs.value)
        }
        break
      }
      case 'KeyD': {
        if ((event.ctrlKey || event.metaKey) && !event.repeat) {
          event.preventDefault()
          if (selectedClipId.value) {
            duplicateClip(selectedClipId.value)
          }
        }
        break
      }
      case 'KeyQ':
      case 'KeyW': {
        if (event.repeat) {
          break
        }
        const sel = selectedClip.value
        if (sel && playheadUs.value > sel.clip.startUs && playheadUs.value < clipEndUs(sel.clip)) {
          resizeClip(sel.clip.id, event.code === 'KeyQ' ? 'left' : 'right', playheadUs.value)
        }
        break
      }
      case 'Delete':
      case 'Backspace': {
        if (selectedClipId.value && !event.repeat) {
          event.preventDefault()
          removeClip(selectedClipId.value)
        }
        break
      }
      case 'Equal': {
        zoomBy(1.5)
        break
      }
      case 'Minus': {
        zoomBy(1 / 1.5)
        break
      }
      case 'Escape': {
        selectedClipId.value = null
        break
      }
    }
  }

  function onKeyUp (event: KeyboardEvent) {
    if (event.code === 'Space') {
      const wasHeld = spaceHeld.value
      spaceHeld.value = false
      if (wasHeld && !panOccurred && !isEditableTarget(event.target)) {
        toggle()
      }
    }
  }

  function attach () {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
  }

  function detach () {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    spaceHeld.value = false
  }

  return { spaceHeld, markPanOccurred, attach, detach }
}

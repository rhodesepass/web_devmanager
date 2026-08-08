import type { Project } from './model'
import { segmentExportDurationUs } from './model'

/**
 * 生成设备端 epconfig.json（version 2）。
 * 字段与 Android 端 MaterialVideoExporter.writeFullConfig 逐字段对齐：
 * 时间 us、颜色 #RRGGBB 大写、预设图固定文件名、可选字段非空才写。
 */

export const LOOP_FILE = 'loop.mp4'
export const INTRO_FILE = 'intro.mp4'
export const ICON_FILE = 'icon.png'
export const OVERLAY_LOGO_FILE = 'overlay_logo.png'
export const OVERLAY_OP_ICON_FILE = 'overlay_op_icon.png'
export const OVERLAY_IMAGE_FILE = 'overlay.png'

export interface EpconfigOptions {
  uuid: string
  /** 是否有 icon.png（自动生成成功时为 true） */
  hasIcon: boolean
}

function normalizeColor (color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  return m ? `#${m[1].toUpperCase()}` : '#000000'
}

export function buildEpconfig (project: Project, options: EpconfigOptions): string {
  const config: Record<string, unknown> = {
    version: 2,
    uuid: options.uuid,
    name: project.name.trim() || '未命名素材',
    description: project.description.trim() || '(无描述)',
    screen: project.canvas.width >= 720 ? '720x1280' : '360x640',
  }
  if (options.hasIcon) {
    config.icon = ICON_FILE
  }
  config.loop = { file: LOOP_FILE }
  // intro 关闭时 intro/transition_loop 整段不写（对齐 Android：从不写 enabled:false）
  if (project.introEnabled) {
    config.intro = {
      enabled: true,
      file: INTRO_FILE,
      // 帧栅格量化值，与实际编码出的 intro.mp4 长度逐 us 一致（设备排期依赖）
      duration: segmentExportDurationUs(project, 'intro'),
    }
    if (project.transitionLoop) {
      config.transition_loop = {
        type: project.transitionLoop.type,
        options: {
          duration: project.transitionLoop.durationUs,
          background_color: normalizeColor(project.transitionLoop.backgroundColor),
        },
      }
    }
  }
  // 无配置时写 type none 与 Android 端一致
  config.transition_in = project.transitionIn
    ? {
        type: project.transitionIn.type,
        options: {
          duration: project.transitionIn.durationUs,
          background_color: normalizeColor(project.transitionIn.backgroundColor),
        },
      }
    : { type: 'none' }

  const overlay = project.overlay
  if (overlay.type === 'arknights') {
    const opts: Record<string, unknown> = {
      appear_time: overlay.appearTimeUs,
      operator_name: overlay.operatorName,
      operator_code: overlay.operatorCode,
      barcode_text: overlay.barcodeText,
      aux_text: overlay.auxText,
      staff_text: overlay.staffText,
      color: normalizeColor(overlay.color),
    }
    if (overlay.logoPreset || overlay.customLogo) {
      opts.logo = OVERLAY_LOGO_FILE
    }
    if (overlay.classIcon || overlay.customClassIcon) {
      opts.operator_class_icon = OVERLAY_OP_ICON_FILE
    }
    if (overlay.topLeftRhodes.length > 0) {
      opts.top_left_rhodes = overlay.topLeftRhodes
    }
    if (overlay.topRightBarText.length > 0) {
      opts.top_right_bar_text = overlay.topRightBarText
    }
    config.overlay = { type: 'arknights', options: opts }
  } else if (overlay.type === 'image') {
    const opts: Record<string, unknown> = {
      appear_time: overlay.appearTimeUs,
      duration: overlay.durationUs,
    }
    if (overlay.image) {
      opts.image = OVERLAY_IMAGE_FILE
    }
    config.overlay = { type: 'image', options: opts }
  } else {
    config.overlay = { type: 'none' }
  }

  return JSON.stringify(config, null, 2)
}

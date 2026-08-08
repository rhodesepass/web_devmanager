import type { Project } from './model'
import {
  buildEpconfig,
  ICON_FILE,
  INTRO_FILE,
  LOOP_FILE,
  OVERLAY_IMAGE_FILE,
  OVERLAY_LOGO_FILE,
  OVERLAY_OP_ICON_FILE,
} from './epconfig'

export interface MaterialFile {
  name: string
  data: Uint8Array
}

export interface PackageInput {
  project: Project
  uuid: string
  loopMp4: Uint8Array
  /** introEnabled 时必须提供，否则不打包 intro */
  introMp4: Uint8Array | null
  iconPng: Uint8Array | null
  /** overlay=arknights 时提供（bytes 由 UI 层解析预设或自定义图得到） */
  logoPng: Uint8Array | null
  classIconPng: Uint8Array | null
  /** overlay=image 时提供 */
  overlayImagePng: Uint8Array | null
  /** 工程 json（serializeProject 产物）：随包带走方便日后找回剪辑数据，设备端忽略未知文件 */
  projectJson: string | null
}

/** 组装素材目录文件清单（平铺，无子目录），zip 打包由宿主 zipMaterial.ts 完成 */
export function buildMaterialFiles (input: PackageInput): MaterialFile[] {
  const { project } = input
  const encoder = new TextEncoder()
  const files: MaterialFile[] = [
    {
      name: 'epconfig.json',
      data: encoder.encode(buildEpconfig(project, {
        uuid: input.uuid,
        hasIcon: input.iconPng !== null,
      })),
    },
    { name: LOOP_FILE, data: input.loopMp4 },
  ]
  if (project.introEnabled && input.introMp4) {
    files.push({ name: INTRO_FILE, data: input.introMp4 })
  }
  if (input.projectJson) {
    files.push({ name: 'project.epedit.json', data: encoder.encode(input.projectJson) })
  }
  if (input.iconPng) {
    files.push({ name: ICON_FILE, data: input.iconPng })
  }
  if (project.overlay.type === 'arknights') {
    // bytes 来源可以是预设资源或自定义图（UI 层已解析），非空即打包
    if (input.logoPng) {
      files.push({ name: OVERLAY_LOGO_FILE, data: input.logoPng })
    }
    if (input.classIconPng) {
      files.push({ name: OVERLAY_OP_ICON_FILE, data: input.classIconPng })
    }
  }
  if (project.overlay.type === 'image' && input.overlayImagePng) {
    files.push({ name: OVERLAY_IMAGE_FILE, data: input.overlayImagePng })
  }
  return files
}

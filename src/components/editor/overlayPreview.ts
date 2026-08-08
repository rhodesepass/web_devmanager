import type { ArknightsOverlay, LogoPreset, OperatorClass, OverlayConfig } from '@/editor-core/model'
import Konva from 'konva'
import casterIcon from '@/assets/editor/overlay/class_icons/caster.png'
import defenderIcon from '@/assets/editor/overlay/class_icons/defender.png'
import guardIcon from '@/assets/editor/overlay/class_icons/guard.png'
import medicIcon from '@/assets/editor/overlay/class_icons/medic.png'
import sniperIcon from '@/assets/editor/overlay/class_icons/sniper.png'
import specialistIcon from '@/assets/editor/overlay/class_icons/specialist.png'
import supporterIcon from '@/assets/editor/overlay/class_icons/supporter.png'
import vanguardIcon from '@/assets/editor/overlay/class_icons/vanguard.png'
import arknightsLogo from '@/assets/editor/overlay/logo/arknights.png'
import starrailLogo from '@/assets/editor/overlay/logo/starrail.png'
import akBar from '@/assets/editor/overlay/template/ak_bar.png'
import btmLeftBar from '@/assets/editor/overlay/template/btm_left_bar.png'
import topLeftRect from '@/assets/editor/overlay/template/top_left_rect.png'
import topLeftRhodes from '@/assets/editor/overlay/template/top_left_rhodes.png'
import topRightArrow from '@/assets/editor/overlay/template/top_right_arrow.png'
import topRightBar from '@/assets/editor/overlay/template/top_right_bar.png'
import * as L from '@/editor-core/overlay/arknightsLayout'

export const CLASS_ICON_URLS: Record<OperatorClass, string> = {
  vanguard: vanguardIcon,
  guard: guardIcon,
  defender: defenderIcon,
  sniper: sniperIcon,
  caster: casterIcon,
  medic: medicIcon,
  supporter: supporterIcon,
  specialist: specialistIcon,
}

export const LOGO_URLS: Record<LogoPreset, string> = {
  arknights: arknightsLogo,
  starrail: starrailLogo,
}

const FONT_DISPLAY = '"Bebas Neue", sans-serif'
const FONT_BODY = '"Source Sans 3", sans-serif'

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage (url: string): Promise<HTMLImageElement> {
  let cached = imageCache.get(url)
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const img = new Image()
      img.src = url
      img.addEventListener('load', () => resolve(img), { once: true })
      img.addEventListener('error', () => reject(new Error(`overlay 资源加载失败: ${url}`)), { once: true })
    })
    imageCache.set(url, cached)
  }
  return cached
}

/**
 * arknights overlay 的 Konva 预览（表单驱动、不进关键帧/导出渲染）。
 * 坐标全按 360x640 逻辑基准画进 group，720 档由 group.scale(2) 处理。
 */
export class ArknightsOverlayPreview {
  private readonly group: Konva.Group
  private generation = 0
  private fontsReady: Promise<unknown>

  constructor (layer: Konva.Layer) {
    this.group = new Konva.Group({ listening: false })
    layer.add(this.group)
    this.fontsReady = Promise.allSettled([
      document.fonts.load(`${L.OPNAME_FONT_SIZE}px "Bebas Neue"`),
      document.fonts.load(`${L.BODY_FONT_SIZE}px "Source Sans 3"`),
    ])
  }

  setScale (uiScale: number) {
    this.group.scale({ x: uiScale, y: uiScale })
  }

  destroy () {
    this.group.destroy()
  }

  /** 全量重建（表单变更频率低，重建比 diff 简单可靠） */
  async update (overlay: OverlayConfig, visible: boolean): Promise<void> {
    const gen = ++this.generation
    this.group.destroyChildren()
    if (!visible || overlay.type === 'none') {
      this.group.getLayer()?.batchDraw()
      return
    }
    if (overlay.type === 'image') {
      // 固件语义：图片按原大小、屏幕左上角原点静态绘制
      if (overlay.image) {
        const img = await loadImage(overlay.image)
        if (gen !== this.generation) {
          return
        }
        this.group.add(new Konva.Image({
          image: img,
          x: 0,
          y: 0,
          width: img.naturalWidth,
          height: img.naturalHeight,
          listening: false,
        }))
      }
      this.group.getLayer()?.batchDraw()
      return
    }
    await this.fontsReady
    const nodes = await buildNodes(overlay)
    if (gen !== this.generation) {
      return
    }
    for (const node of nodes) {
      this.group.add(node)
    }
    this.group.getLayer()?.batchDraw()
  }
}

async function buildNodes (config: ArknightsOverlay): Promise<Konva.Shape[]> {
  const [rectImg, btmBarImg, topBarImg, rhodesImg, arrowImg, akBarImg] = await Promise.all([
    loadImage(topLeftRect),
    loadImage(btmLeftBar),
    loadImage(topRightBar),
    loadImage(topLeftRhodes),
    loadImage(topRightArrow),
    loadImage(akBar),
  ])
  // 自定义图（dataURL）优先于预设；dataURL 内容即缓存 key，换图自动失效
  const logoUrl = config.customLogo ?? (config.logoPreset ? LOGO_URLS[config.logoPreset] : null)
  const classUrl = config.customClassIcon ?? (config.classIcon ? CLASS_ICON_URLS[config.classIcon] : null)
  const logoImg = logoUrl ? await loadImage(logoUrl) : null
  const classImg = classUrl ? await loadImage(classUrl) : null

  const nodes: Konva.Shape[] = []
  const img = (image: HTMLImageElement, x: number, y: number, w?: number, h?: number) =>
    new Konva.Image({ image, x, y, width: w ?? image.naturalWidth, height: h ?? image.naturalHeight, listening: false })
  const text = (str: string, x: number, y: number, fontSize: number, fontFamily: string) =>
    new Konva.Text({ text: str, x, y, fontSize, fontFamily, fill: 'white', listening: false })

  // 静态模板图
  const topBarX = L.OVERLAY_W - topBarImg.naturalWidth
  nodes.push(
    img(rectImg, L.RECT_OFFSET_X, 0),
    img(btmBarImg, 0, L.OVERLAY_H - btmBarImg.naturalHeight),
    img(topBarImg, topBarX, 0),
  )

  // 左上：rhodes 文字（非空替代默认图，rot90 Bebas Bold 72）
  if (config.topLeftRhodes.length > 0) {
    nodes.push(new Konva.Text({
      text: config.topLeftRhodes,
      x: L.RHODES_TEXT_X + L.RHODES_FONT_SIZE,
      y: L.RHODES_TEXT_Y,
      rotation: 90,
      fontSize: L.RHODES_FONT_SIZE,
      fontFamily: FONT_DISPLAY,
      fontStyle: 'bold',
      fill: 'white',
      listening: false,
    }))
  } else {
    nodes.push(img(rhodesImg, 0, 0))
  }

  // 右上 bar 内嵌文字覆盖
  if (config.topRightBarText.length > 0) {
    nodes.push(new Konva.Rect({
      x: topBarX + L.TOP_RIGHT_BAR_TEXT_X,
      y: L.TOP_RIGHT_BAR_TEXT_Y,
      width: L.TOP_RIGHT_BAR_FONT_SIZE,
      height: L.TOP_RIGHT_BAR_TEXT_BOTTOM - L.TOP_RIGHT_BAR_TEXT_Y,
      fill: 'black',
      listening: false,
    }))
    const space = config.topRightBarText.indexOf(' ')
    const parts = space > 0
      ? [
          { str: config.topRightBarText.slice(0, space), bold: true },
          { str: config.topRightBarText.slice(space + 1), bold: false },
        ]
      : [{ str: config.topRightBarText, bold: true }]
    let offset = 2
    for (const part of parts) {
      const node = new Konva.Text({
        text: part.str,
        x: topBarX + L.TOP_RIGHT_BAR_TEXT_X + L.TOP_RIGHT_BAR_FONT_SIZE,
        y: L.TOP_RIGHT_BAR_TEXT_Y + offset,
        rotation: 90,
        fontSize: L.TOP_RIGHT_BAR_FONT_SIZE,
        fontFamily: FONT_DISPLAY,
        fontStyle: part.bold ? 'bold' : 'normal',
        fill: 'white',
        listening: false,
      })
      offset += node.getTextWidth() + 6
      nodes.push(node)
    }
  }

  nodes.push(img(arrowImg, L.OVERLAY_W - arrowImg.naturalWidth, L.TOP_RIGHT_ARROW_Y))

  // 分隔线
  for (const y of [L.UPPER_LINE_Y, L.LOWER_LINE_Y]) {
    nodes.push(new Konva.Rect({
      x: L.BTM_INFO_X,
      y,
      width: L.LINE_WIDTH,
      height: 1,
      fill: 'white',
      listening: false,
    }))
  }

  // ak_bar 横条 + 文本区
  nodes.push(
    img(akBarImg, L.BTM_INFO_X, L.AK_BAR_Y),
    text(config.operatorName, L.BTM_INFO_X, L.OPNAME_Y, L.OPNAME_FONT_SIZE, FONT_DISPLAY),
    text(config.operatorCode, L.BTM_INFO_X, L.OPCODE_Y, L.BODY_FONT_SIZE, FONT_BODY),
    text(config.staffText, L.BTM_INFO_X, L.STAFF_TEXT_Y, L.BODY_FONT_SIZE, FONT_BODY),
  )
  for (const [i, line] of config.auxText.split('\n').slice(0, L.AUX_TEXT_MAX_LINES).entries()) {
    nodes.push(text(line, L.BTM_INFO_X, L.AUX_TEXT_Y + i * L.AUX_TEXT_LINE_H, L.BODY_FONT_SIZE, FONT_BODY))
  }

  // 职业图标
  if (classImg) {
    nodes.push(img(classImg, L.BTM_INFO_X, L.CLASS_ICON_Y, L.CLASS_ICON_SIDE, L.CLASS_ICON_SIDE))
  }

  // 条码占位（与安卓一致：黑底 + 条纹主体占左 70% + rot90 文字）
  nodes.push(new Konva.Rect({
    x: L.BARCODE_X,
    y: L.BARCODE_Y,
    width: L.BARCODE_W,
    height: L.BARCODE_H,
    fill: 'black',
    listening: false,
  }))
  const bodyW = L.BARCODE_W * 0.7
  let barY = L.BARCODE_Y + 2
  let seed = 0
  for (const ch of config.barcodeText) {
    seed = (seed * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  while (barY < L.BARCODE_Y + L.BARCODE_H - 2) {
    seed = (seed * 1_103_515_245 + 12_345) >>> 0
    const h = 1 + (seed % 3)
    if ((seed >> 8) % 2 === 0) {
      nodes.push(new Konva.Rect({
        x: L.BARCODE_X,
        y: barY,
        width: bodyW,
        height: h,
        fill: 'white',
        listening: false,
      }))
    }
    barY += h + 1
  }
  // 条码文字 + 右下主题色径向渐变（终态 radius 192，向左上渐变到透明）
  nodes.push(
    new Konva.Text({
      text: config.barcodeText,
      x: L.BARCODE_X + L.BARCODE_W - 2,
      y: L.BARCODE_Y + 4,
      rotation: 90,
      fontSize: 12,
      fontFamily: FONT_BODY,
      fill: 'white',
      listening: false,
    }),
    new Konva.Rect({
      x: 0,
      y: 0,
      width: L.OVERLAY_W,
      height: L.OVERLAY_H,
      listening: false,
      fillRadialGradientStartPoint: { x: L.OVERLAY_W, y: L.OVERLAY_H },
      fillRadialGradientEndPoint: { x: L.OVERLAY_W, y: L.OVERLAY_H },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: L.COLOR_FADE_RADIUS,
      fillRadialGradientColorStops: [0, config.color, 1, 'rgba(0,0,0,0)'],
    }),
  )

  // logo 右下
  if (logoImg) {
    nodes.push(img(
      logoImg,
      L.OVERLAY_W - logoImg.naturalWidth - L.LOGO_PADDING,
      L.OVERLAY_H - logoImg.naturalHeight - L.LOGO_PADDING,
    ))
  }

  return nodes
}

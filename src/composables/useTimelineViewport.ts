import { computed, nextTick, ref } from 'vue'

/**
 * 时间轴视口（模块级单例）：像素↔时间换算、缩放、磁吸、边缘自动滚动。
 * 轨道头列占 HEADER_W，所有横向定位必须走 timeToLeft/leftToTime，
 * 禁止裸 usToPx 定位（会差一个 HEADER_W）。
 */

export const HEADER_W = 140
const PPS_MIN = 20
const PPS_MAX = 400
/** 磁吸判定半径（屏幕像素） */
const SNAP_PX = 8
/** 距滚动容器边缘该距离内触发自动滚动 */
const EDGE_PX = 36
const EDGE_SCROLL_SPEED = 14

const pxPerSecond = ref(80)
const scrollRef = ref<HTMLDivElement>()

export type TimelineTool = 'select' | 'razor' | 'stretch'
/** 时间轴工具模式：光标（选择/移动/裁剪）、剃刀（点击切割）、比率拉伸（拖边缘改速率） */
const toolMode = ref<TimelineTool>('select')

export function useTimelineViewport () {
  function usToPx (us: number): number {
    return us / 1_000_000 * pxPerSecond.value
  }

  function pxToUs (px: number): number {
    return Math.round(px / pxPerSecond.value * 1_000_000)
  }

  function timeToLeft (us: number): number {
    return HEADER_W + usToPx(us)
  }

  function leftToTime (px: number): number {
    return Math.max(0, pxToUs(px - HEADER_W))
  }

  /** clientX（视口坐标）→ 段时刻 */
  function clientXToTime (clientX: number): number {
    const el = scrollRef.value
    if (!el) {
      return 0
    }
    const rect = el.getBoundingClientRect()
    return leftToTime(clientX - rect.left + el.scrollLeft)
  }

  function clampPps (v: number): number {
    return Math.min(Math.max(v, PPS_MIN), PPS_MAX)
  }

  const zoomSlider = computed({
    get: () => Math.log(pxPerSecond.value / PPS_MIN) / Math.log(PPS_MAX / PPS_MIN),
    set: (v: number) => {
      pxPerSecond.value = PPS_MIN * (PPS_MAX / PPS_MIN) ** v
    },
  })

  /** 缩放时保持 anchor（默认视口中心）对应的时间点不动 */
  async function zoomAnchored (newPps: number, cursorInView?: number) {
    const el = scrollRef.value
    const pps = clampPps(newPps)
    if (!el || pps === pxPerSecond.value) {
      pxPerSecond.value = pps
      return
    }
    const anchorView = cursorInView ?? el.clientWidth / 2
    const anchorUs = leftToTime(el.scrollLeft + anchorView)
    pxPerSecond.value = pps
    // 内容宽度是 :style 绑定，同帧读的还是旧宽，等 DOM 更新后再回定位
    await nextTick()
    el.scrollLeft = timeToLeft(anchorUs) - anchorView
  }

  function zoomBy (factor: number) {
    void zoomAnchored(pxPerSecond.value * factor)
  }

  /** 磁吸：proposedUs 落在任一候选点 SNAP_PX 内则吸附；返回吸附结果 */
  function snapUs (proposedUs: number, candidates: readonly number[]): number {
    const thresholdUs = pxToUs(SNAP_PX)
    let best = proposedUs
    let bestDist = thresholdUs + 1
    for (const c of candidates) {
      const d = Math.abs(c - proposedUs)
      if (d < bestDist) {
        bestDist = d
        best = c
      }
    }
    return bestDist <= thresholdUs ? best : proposedUs
  }

  /**
   * 拖动中的边缘自动滚动：pointer 静止在边缘时 pointermove 不再触发，
   * 需要 rAF 循环持续推进并回调最新时间值。
   */
  function startEdgeAutoScroll (getClientX: () => number, onScrolled: () => void): () => void {
    let raf = 0
    const step = () => {
      const el = scrollRef.value
      if (el) {
        const rect = el.getBoundingClientRect()
        const x = getClientX()
        let dx = 0
        if (x < rect.left + HEADER_W + EDGE_PX) {
          dx = -EDGE_SCROLL_SPEED
        } else if (x > rect.right - EDGE_PX) {
          dx = EDGE_SCROLL_SPEED
        }
        if (dx !== 0) {
          const before = el.scrollLeft
          el.scrollLeft += dx
          if (el.scrollLeft !== before) {
            onScrolled()
          }
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }

  return {
    pxPerSecond,
    scrollRef,
    toolMode,
    usToPx,
    pxToUs,
    timeToLeft,
    leftToTime,
    clientXToTime,
    zoomSlider,
    zoomAnchored,
    zoomBy,
    clampPps,
    snapUs,
    startEdgeAutoScroll,
  }
}

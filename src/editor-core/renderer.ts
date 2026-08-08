import type { FrameProvider } from './frameSource'
import type { TransformState } from './interpolate'
import type { Clip, SegmentView } from './model'
import { effectsToFilter } from './effects'
import {
  adjacentPrevClip,
  clipTimeToSourceTime,
  defaultTransform,
  findActiveClip,
  sampleClip,
} from './interpolate'
import { frameToUs } from './model'
import { collectDipOverlays, crossfadeProgress } from './transitions'

/**
 * 离线逐帧合成器：与画布预览共用 sampleClip / transitions 这份数学真源，
 * 但绘制走 OffscreenCanvas 2D，完全不经过 Konva。
 * 特效经 ctx.filter（CSS filter 语法）栅格化，与预览侧同一份 effectsToFilter。
 */
export class OfflineRenderer {
  private readonly canvas: OffscreenCanvas
  private readonly ctx: OffscreenCanvasRenderingContext2D
  /** crossfade 前段冻结尾帧快照：前后 clip 同 asset 时避免交叠期逐帧交替 seek */
  private readonly frozenFrames = new Map<string, ImageBitmap>()

  constructor (
    private readonly view: SegmentView,
    private readonly getFrame: FrameProvider,
  ) {
    this.canvas = new OffscreenCanvas(view.canvas.width, view.canvas.height)
    const ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!ctx) {
      throw new Error('OffscreenCanvas 2D 上下文创建失败')
    }
    if (!('filter' in ctx)) {
      throw new Error('当前环境不支持 canvas filter，无法渲染特效')
    }
    this.ctx = ctx
  }

  /**
   * 渲染第 frame 帧（0 起）。变换按帧起始时刻采样；
   * 视频源画面取帧中点 (frame+0.5)/fps，规避 seek 边界抖动。
   */
  async renderFrame (frame: number): Promise<ImageData> {
    const { width, height } = this.view.canvas
    const tUs = frameToUs(frame, this.view.fps)
    const midUs = tUs + Math.round(500_000 / this.view.fps)
    const ctx = this.ctx

    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    for (const track of this.view.tracks) {
      const clip = findActiveClip(track, tUs)
      if (!clip) {
        continue
      }
      let alphaMul = 1
      if (clip.transitionIn?.type === 'crossfade') {
        const dur = Math.min(clip.transitionIn.durationUs, clip.durationUs)
        const p = crossfadeProgress(tUs, clip.startUs, dur)
        if (p !== null) {
          alphaMul = p
          const prev = adjacentPrevClip(track, clip)
          if (prev) {
            await this.drawClip(prev, prev.durationUs, 1 - p, true)
          }
        }
      }
      await this.drawClip(clip, midUs - clip.startUs, alphaMul, false, tUs - clip.startUs)
    }

    for (const overlay of collectDipOverlays(this.view.tracks, tUs)) {
      ctx.globalAlpha = overlay.alpha
      ctx.fillStyle = overlay.color
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1
    }

    return ctx.getImageData(0, 0, width, height)
  }

  /** 渲染第 frame 帧并返回画布本体（icon 生成等场景直接用） */
  async renderFrameToCanvas (frame: number): Promise<OffscreenCanvas> {
    await this.renderFrame(frame)
    return this.canvas
  }

  /** 释放冻结帧快照（导出结束调用；预览侧 renderer 短命实例可不调） */
  dispose (): void {
    for (const bitmap of this.frozenFrames.values()) {
      bitmap.close()
    }
    this.frozenFrames.clear()
  }

  /**
   * @param mediaLocalUs 取源画面用的局部时刻（帧中点）
   * @param sampleLocalUs 变换采样用的局部时刻（帧起始）；缺省与 mediaLocalUs 相同（冻结帧场景）
   */
  private async drawClip (
    clip: Clip,
    mediaLocalUs: number,
    alphaMul: number,
    frozen: boolean,
    sampleLocalUs: number = mediaLocalUs,
  ): Promise<void> {
    const asset = this.view.assetById.get(clip.assetId)
    if (!asset) {
      return
    }
    const state: TransformState = sampleClip(clip, sampleLocalUs) ?? defaultTransform(this.view.canvas)
    const alpha = state.opacity * alphaMul
    if (alpha <= 0) {
      return
    }
    const image = frozen
      ? await this.frozenFrame(clip)
      : await this.getFrame(
          clip,
          asset,
          asset.kind === 'video' ? clipTimeToSourceTime(clip, mediaLocalUs, asset.durationUs) : 0,
        )
    if (!image) {
      return
    }
    const ctx = this.ctx
    ctx.save()
    const filter = effectsToFilter(clip.effects, 1)
    if (filter) {
      ctx.filter = filter
    }
    ctx.translate(state.x, state.y)
    ctx.rotate(state.rotation * Math.PI / 180)
    ctx.scale(state.scaleX, state.scaleY)
    ctx.globalAlpha = alpha
    ctx.drawImage(image, -asset.width / 2, -asset.height / 2, asset.width, asset.height)
    ctx.restore()
  }

  private async frozenFrame (clip: Clip): Promise<ImageBitmap | null> {
    const cached = this.frozenFrames.get(clip.id)
    if (cached) {
      return cached
    }
    const asset = this.view.assetById.get(clip.assetId)
    if (!asset) {
      return null
    }
    const src = await this.getFrame(
      clip,
      asset,
      asset.kind === 'video' ? clipTimeToSourceTime(clip, clip.durationUs, asset.durationUs) : 0,
    )
    if (!src) {
      return null
    }
    const bitmap = await createImageBitmap(src)
    this.frozenFrames.set(clip.id, bitmap)
    return bitmap
  }
}

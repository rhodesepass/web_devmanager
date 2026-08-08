import type { AssetMeta, Clip } from './model'

/**
 * 逐帧取源画面的异步接口。
 * 当前实现是 <video> seek + seeked（宿主 composable 提供）；
 * 换 WebCodecs 时只换实现，渲染/导出管线不动。
 * @param clip 目标 clip（预览实现可按 clip.id 选独立元素；导出实现只看 asset）
 * @param asset clip 引用的素材元数据
 * @param sourceTimeUs 源素材内的时刻（已做过 trim 映射、帧中点偏移与冻结钳制）
 */
export type FrameProvider = (
  clip: Clip,
  asset: AssetMeta,
  sourceTimeUs: number,
) => Promise<CanvasImageSource | null>

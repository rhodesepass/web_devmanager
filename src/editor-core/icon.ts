/** 素材图标：合成首帧居中方裁 → ≤256px PNG（与 Android 端行为一致） */
export async function buildIconPng (frame: OffscreenCanvas): Promise<Uint8Array> {
  const srcSide = Math.min(frame.width, frame.height)
  const side = Math.min(srcSide, 256)
  const out = new OffscreenCanvas(side, side)
  const ctx = out.getContext('2d')
  if (!ctx) {
    throw new Error('icon 画布创建失败')
  }
  ctx.drawImage(
    frame,
    (frame.width - srcSide) / 2,
    (frame.height - srcSide) / 2,
    srcSide,
    srcSide,
    0,
    0,
    side,
    side,
  )
  const blob = await out.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

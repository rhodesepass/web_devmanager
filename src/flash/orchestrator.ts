import type { FlashEvent, FlashFiles, FlashSelection } from './types'
import type { OpenedUsb } from './usbFlash'
import { DFU_PRODUCT_ID, DFU_VENDOR_ID } from './constants'
import {
  downloadDfuImage,
  findAndClaimDfuAlt,
  listDfuAlts,
  releaseDfuInterface,
} from './dfu'
import { F1c100sChip } from './f1c100s'
import { FelClient } from './fel'
import { SpiNand } from './spiNand'
import {
  awaitDfuAuthorized,
  closeUsb,
  connectDfuInteractive,
  connectFelInteractive,
  getAuthorizedDevice,
  openUsbDevice,
} from './usbFlash'

export type FlashEventHandler = (event: FlashEvent) => void

function buildBootEnv (rev: string, screen: string): Uint8Array {
  const text = `device_rev=${rev}\nscreen=${screen}\n`
  const encoded = new TextEncoder().encode(text)
  const out = new Uint8Array(encoded.length + 1)
  out.set(encoded)
  out[encoded.length] = 0
  return out
}

/**
 * Probe FEL with no destructive operations. Reads the chip id only.
 * MUST be called synchronously from a user gesture.
 */
export async function probeFel (onEvent: FlashEventHandler): Promise<void> {
  onEvent({ type: 'log', message: '正在请求 FEL 设备授权...' })
  const opened = await connectFelInteractive()
  try {
    const fel = new FelClient(opened)
    const version = await fel.version()
    onEvent({
      type: 'log',
      message: `FEL chip id=0x${version.id.toString(16).padStart(8, '0')}`,
    })
  } finally {
    await closeUsb(opened)
  }
}

/**
 * Probe DFU with no destructive operations. Lists boot/rootfs alt settings.
 * MUST be called synchronously from a user gesture.
 */
export async function probeDfu (onEvent: FlashEventHandler): Promise<void> {
  onEvent({ type: 'log', message: '正在请求 DFU 设备授权...' })
  const opened = await connectDfuInteractive()
  const log = (message: string) => onEvent({ type: 'log', message })
  try {
    const alts = await listDfuAlts(opened)
    onEvent({
      type: 'log',
      message: `DFU 共 ${alts.length} 个 alt: ${alts.map(a =>
        `${a.alternateSetting}=${a.interfaceName ?? '<none>'}`,
      ).join(', ')}`,
    })

    const boot = await findAndClaimDfuAlt(opened, 'boot', log)
    await releaseDfuInterface(opened.device, boot)

    const root = await findAndClaimDfuAlt(opened, 'rootfs', log)
    await releaseDfuInterface(opened.device, root)
  } finally {
    await closeUsb(opened, false)
  }
}

/**
 * Run the FEL stage: erase NAND, write U-Boot/bootenv, then watchdog reset
 * the device into DFU mode. MUST be called synchronously from a user gesture
 * (the FEL chooser will appear if the device is not yet authorized).
 *
 * After this call returns, the device will reboot into DFU mode and the user
 * must press a "continue" button in a fresh user gesture to proceed.
 */
export async function runFlashFelStage (
  selection: FlashSelection,
  files: Pick<FlashFiles, 'uboot'>,
  onEvent: FlashEventHandler,
): Promise<void> {
  onEvent({ type: 'log', message: '正在请求 FEL 设备授权...' })
  let opened: OpenedUsb
  try {
    opened = await connectFelInteractive()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`FEL 授权失败：${msg}`, { cause: error })
  }

  try {
    const fel = new FelClient(opened)
    let version
    try {
      version = await fel.version()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`FEL 探测失败：${msg}（请确认设备已进入 FEL 模式）`, { cause: error })
    }
    onEvent({
      type: 'log',
      message: `FEL chip id=0x${version.id.toString(16).padStart(8, '0')}`,
    })

    const chip = new F1c100sChip(fel)
    const nand = new SpiNand(fel, chip)
    const ctx = await nand.initialize()
    onEvent({ type: 'log', message: `SPI NAND: ${ctx.info.name}` })

    const bootEnv = buildBootEnv(selection.rev, selection.screen)

    onEvent({ type: 'step', title: '擦除 SPI NAND' })
    await nand.erase(ctx, 0x10_00_00, 0xC0_00_00, (done, total) => {
      onEvent({ type: 'progress', done, total })
    })

    onEvent({ type: 'step', title: '写入 U-Boot' })
    await nand.write(ctx, 0, files.uboot, (done, total) => {
      onEvent({ type: 'progress', done, total })
    })

    onEvent({ type: 'step', title: '写入 bootenv' })
    await nand.write(ctx, 0xF_A0_00, bootEnv, (done, total) => {
      onEvent({ type: 'progress', done, total })
    })

    onEvent({ type: 'step', title: '重启到 DFU' })
    await chip.resetWithWatchdog()
  } finally {
    await closeUsb(opened)
  }

  onEvent({
    type: 'log',
    message: '设备已重启进入 DFU 模式，请点击「继续 DFU 烧录」按钮以授权 DFU 设备并继续。',
  })
}

/**
 * Run the DFU stage: download boot, then rootfs. The first boot DFU connect
 * MUST be called synchronously from a user gesture; the rootfs stage will
 * automatically reuse the same authorized device (no extra prompt).
 */
export async function runFlashDfuStage (
  files: Pick<FlashFiles, 'boot' | 'rootfs'>,
  onEvent: FlashEventHandler,
): Promise<void> {
  onEvent({ type: 'log', message: '正在请求 DFU 设备授权...' })
  let openedDfuBoot: OpenedUsb
  try {
    openedDfuBoot = await connectDfuInteractive()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`DFU 授权失败：${msg}（请确认设备已重启进入 DFU 模式）`, { cause: error })
  }

  const log = (message: string) => onEvent({ type: 'log', message })
  try {
    const alts = await listDfuAlts(openedDfuBoot)
    log(`DFU 共 ${alts.length} 个 alt: ${alts.map(a =>
      `${a.alternateSetting}=${a.interfaceName ?? '<none>'}`,
    ).join(', ')}`)

    const bootClaim = await findAndClaimDfuAlt(openedDfuBoot, 'boot', log)
    onEvent({ type: 'step', title: '烧录 boot 分区' })
    await downloadDfuImage(
      openedDfuBoot.device,
      bootClaim.interfaceNumber,
      files.boot,
      2048,
      (done, total) => onEvent({ type: 'progress', done, total }),
      log,
    )
    await releaseDfuInterface(openedDfuBoot.device, bootClaim)
  } finally {
    await closeUsb(openedDfuBoot, false)
  }

  onEvent({ type: 'waiting', mode: 'DFU(rootfs)' })
  let openedDfuRoot: OpenedUsb
  try {
    openedDfuRoot = await awaitDfuAuthorized(60_000)
  } catch {
    const existing = await getAuthorizedDevice(DFU_VENDOR_ID, DFU_PRODUCT_ID)
    if (!existing) {
      throw new Error('rootfs 阶段未检测到已授权的 DFU 设备，请重新插拔后再试')
    }
    openedDfuRoot = await openUsbDevice(existing, { requireBulk: false, claimInterface: false })
  }

  try {
    const rootClaim = await findAndClaimDfuAlt(openedDfuRoot, 'rootfs', log)
    onEvent({ type: 'step', title: '烧录 rootfs 分区' })
    await downloadDfuImage(
      openedDfuRoot.device,
      rootClaim.interfaceNumber,
      files.rootfs,
      2048,
      (done, total) => onEvent({ type: 'progress', done, total }),
      log,
    )
    await releaseDfuInterface(openedDfuRoot.device, rootClaim)
  } finally {
    await closeUsb(openedDfuRoot, false)
  }

  onEvent({ type: 'done' })
}

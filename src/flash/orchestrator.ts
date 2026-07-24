import type { ClaimedDfuInterface } from './dfu'
import type { FlashEvent, FlashFiles, FlashSelection, FlashTarget } from './types'
import type { OpenedUsb } from './usbFlash'
import { DFU_PRODUCT_ID, DFU_VENDOR_ID } from './constants'
import { DDR_PAYLOAD } from './ddrPayload'
import {
  DfuClient,
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
  reopenFel,
} from './usbFlash'

export type FlashEventHandler = (event: FlashEvent) => void

// 新方法（flash.py 方案）用到的固定地址
const DDR_PAYLOAD_ADDR = 0x00_00_88_00
const DDR_MAILBOX = 0x5c
const DDR_MAILBOX_MAGIC = 0x58
const DRAM_BOOTINFO_ADDR = 0x80_00_00_00
const DRAM_UBOOT_ADDR = 0x81_70_00_00
const FEL_WRITE_CHUNK = 64 * 1024

function buildBootEnv (rev: string, screen: string): Uint8Array {
  const text = `device_rev=${rev}\nscreen=${screen}\n`
  const encoded = new TextEncoder().encode(text)
  const out = new Uint8Array(encoded.length + 1)
  out.set(encoded)
  out[encoded.length] = 0
  return out
}

/**
 * 构造 flash.py 里 make_bootinfo 写的 .bootinfo.txt：
 * "Mostima_" + boot_type + 3×0x00 + <u32 LE> len(env) + env
 */
function buildBootInfo (selection: FlashSelection, bootType: number): Uint8Array {
  const env = buildBootEnv(selection.rev, selection.screen)
  const out = new Uint8Array(8 + 4 + 4 + env.length)
  out.set(new TextEncoder().encode('Mostima_'), 0)
  out[8] = bootType
  new DataView(out.buffer).setUint32(12, env.length, true)
  out.set(env, 16)
  return out
}

/** 上传 DDR 初始化 payload 并执行（等价 xfel ddr），返回容量 MB */
async function initDdr (fel: FelClient): Promise<number> {
  await fel.write32(DDR_MAILBOX, 0)
  await fel.write(DDR_PAYLOAD_ADDR, DDR_PAYLOAD)
  await fel.exec(DDR_PAYLOAD_ADDR)
  const mailbox = await fel.read32(DDR_MAILBOX)
  if ((mailbox >>> 24) !== DDR_MAILBOX_MAGIC) {
    throw new Error('DDR 初始化失败：payload 自检未通过（信箱无成功标记）')
  }
  return mailbox & 0xff_ff_ff
}

/** 分块写内存并上报进度（FelClient.write 内部虽已分块，但不回调进度） */
async function felWriteWithProgress (
  fel: FelClient,
  address: number,
  data: Uint8Array,
  onEvent: FlashEventHandler,
): Promise<void> {
  for (let off = 0; off < data.length; off += FEL_WRITE_CHUNK) {
    const end = Math.min(off + FEL_WRITE_CHUNK, data.length)
    await fel.write(address + off, data.subarray(off, end))
    onEvent({ type: 'progress', done: end, total: data.length })
  }
}

const DFU_CLAIM_RETRY_MS = 20_000

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 连接/claim 阶段的失败（设备正在擦除、刚重新枚举、授权已失效等）。
 * 调用方据此回到「等待点击」状态让用户重试，而不是把整次烧录判死。
 */
export class DfuNotReadyError extends Error {}

/**
 * 在已打开的句柄上 claim 目标 alt 并用 GETSTATUS 探活；失败则丢掉句柄，
 * 从 getDevices() 重新取设备对象重试（设备重新枚举后旧句柄必然失效）。
 *
 * 注意 Chrome 的 WebUSB 授权按 (VID, PID, iSerial) 记忆——本机 gadget
 * 没有 iSerial，授权只对当次枚举有效，重新枚举后 getDevices() 会拿不到
 * 设备。这里不弹窗（弹窗必须在用户手势里），拿不到就抛 DfuNotReadyError
 * 让用户再点一次按钮。
 */
async function claimDfuWithRetry (
  initial: OpenedUsb,
  altName: string,
  log: (message: string) => void,
): Promise<{ opened: OpenedUsb, claim: ClaimedDfuInterface }> {
  const deadline = Date.now() + DFU_CLAIM_RETRY_MS
  let opened: OpenedUsb | null = initial
  let lastMessage = ''
  let first = true
  while (true) {
    try {
      if (!opened) {
        const device = await getAuthorizedDevice(DFU_VENDOR_ID, DFU_PRODUCT_ID)
        if (!device) {
          throw new Error('设备重新枚举后授权已失效')
        }
        opened = await openUsbDevice(device, { requireBulk: false, claimInterface: false })
      }
      const claim = await findAndClaimDfuAlt(opened, altName, first ? log : undefined)
      await new DfuClient(opened.device, claim.interfaceNumber).getStatus()
      return { opened, claim }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (first || message !== lastMessage) {
        log(`DFU 设备尚未就绪（${message}），重试中...`)
      }
      lastMessage = message
      first = false
      if (opened) {
        await closeUsb(opened, false)
        opened = null
      }
      if (Date.now() >= deadline) {
        throw new DfuNotReadyError(`DFU(${altName}) 设备未就绪：${lastMessage}`)
      }
      await sleep(1000)
    }
  }
}

async function dfuWriteClaimed (
  opened: OpenedUsb,
  claim: ClaimedDfuInterface,
  stepTitle: string,
  data: Uint8Array,
  onEvent: FlashEventHandler,
  log: (message: string) => void,
): Promise<void> {
  onEvent({ type: 'step', title: stepTitle })
  await downloadDfuImage(
    opened.device,
    claim.interfaceNumber,
    data,
    2048,
    (done, total) => onEvent({ type: 'progress', done, total }),
    log,
  )
  await releaseDfuInterface(opened.device, claim)
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

// ===========================================================================
// 新烧录方法（移植自 ../buildroot/flash.py）
//
// 与老方法的差别只在 FEL 阶段：不再用 FEL 直接擦写 SPI NAND，而是先初始化
// DDR，把引导信息（Mostima 头 + bootenv）写到 DRAM 0x80000000，再把
// u-boot.bin 载入 0x81700000 执行。该 u-boot 起来后自身提供 DFU，
// 依次接收 uboot / boot / rootfs 三个分区并落盘（NAND 或 SD 由 boot_type 决定）。
// ===========================================================================

async function runFelStageNewBody (
  opened: OpenedUsb,
  selection: FlashSelection,
  target: FlashTarget,
  files: Pick<FlashFiles, 'felboot'>,
  onEvent: FlashEventHandler,
): Promise<void> {
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

  onEvent({ type: 'step', title: '初始化 DDR' })
  const sizeMb = await initDdr(fel)
  onEvent({ type: 'log', message: `DDR 初始化完成，容量 ${sizeMb}MB` })

  onEvent({ type: 'step', title: '写入引导信息' })
  const bootType = target === 'nand' ? 0x01 : 0x02
  await fel.write(DRAM_BOOTINFO_ADDR, buildBootInfo(selection, bootType))
  onEvent({
    type: 'log',
    message: `引导目标：${target === 'nand' ? 'NAND(系统盘)' : 'SD(数据盘)'}，`
      + `device_rev=${selection.rev} screen=${selection.screen}`,
  })

  onEvent({ type: 'step', title: '载入 U-Boot 到内存' })
  await felWriteWithProgress(fel, DRAM_UBOOT_ADDR, files.felboot, onEvent)

  onEvent({ type: 'step', title: '执行 U-Boot' })
  await fel.exec(DRAM_UBOOT_ADDR)
}

const FEL_STAGE_ATTEMPTS = 3

/**
 * 新方法 FEL 阶段：DDR 初始化 -> 写引导信息 -> 载入并执行 u-boot。
 * 必须在用户手势内同步调用（会弹 FEL 授权窗）。返回后设备会自行进入 DFU。
 *
 * 首次进入 FEL 后第一笔大块 transferOut 偶发 STALL，而设备本身仍留在
 * FEL 模式——close/reopen + clearHalt 后从头重跑一遍即可恢复，故整个
 * 阶段自动重试（等价于用户手点第二次）。
 */
export async function runFlashFelStageNew (
  selection: FlashSelection,
  target: FlashTarget,
  files: Pick<FlashFiles, 'felboot'>,
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
    for (let attempt = 1; ; attempt++) {
      try {
        await runFelStageNewBody(opened, selection, target, files, onEvent)
        break
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        if (attempt >= FEL_STAGE_ATTEMPTS || msg.includes('已断开')) {
          throw error
        }
        onEvent({
          type: 'log',
          message: `FEL 传输出错（${msg}），重新连接后自动重试（第 ${attempt + 1}/${FEL_STAGE_ATTEMPTS} 次）...`,
        })
        await closeUsb(opened)
        await sleep(500)
        opened = await reopenFel()
      }
    }
  } finally {
    await closeUsb(opened)
  }

  onEvent({
    type: 'log',
    message: '设备正在启动 U-Boot 并进入 DFU 模式，请点击「继续 DFU 烧录」按钮以授权 DFU 设备并继续。',
  })
}

export type DfuPartitionAlt = 'uboot' | 'boot' | 'rootfs'

/**
 * 新方法 DFU 阶段：单个分区的烧录。gadget 无 iSerial，每次重新枚举后
 * Chrome 都会丢掉授权，因此每个分区都必须在一次新的用户手势内调用本
 * 函数（内部按需弹授权窗）。写完不发 done——由调用方决定还有没有下一个
 * 分区。连接/claim 阶段的失败以 DfuNotReadyError 抛出，调用方应回到
 * 等待点击状态让用户稍后重试。
 */
export async function runFlashDfuPartitionNew (
  alt: DfuPartitionAlt,
  data: Uint8Array,
  onEvent: FlashEventHandler,
): Promise<void> {
  const log = (message: string) => onEvent({ type: 'log', message })

  onEvent({ type: 'log', message: '正在请求 DFU 设备授权...' })
  let initial: OpenedUsb
  try {
    initial = await connectDfuInteractive()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new DfuNotReadyError(`DFU 授权失败：${msg}（请确认设备已进入 DFU 模式）`)
  }

  if (alt === 'uboot') {
    const alts = await listDfuAlts(initial)
    log(`DFU 共 ${alts.length} 个 alt: ${alts.map(a =>
      `${a.alternateSetting}=${a.interfaceName ?? '<none>'}`,
    ).join(', ')}`)
  }

  const { opened, claim } = await claimDfuWithRetry(initial, alt, log)
  try {
    await dfuWriteClaimed(opened, claim, `烧录 ${alt} 分区`, data, onEvent, log)
  } finally {
    await closeUsb(opened, false)
  }
}

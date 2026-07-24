import { DFU_PRODUCT_ID, DFU_VENDOR_ID, FEL_PRODUCT_ID, FEL_VENDOR_ID } from './constants'

export interface BulkEndpoints {
  epIn: number
  epOut: number
}

export interface OpenedUsb {
  device: USBDevice
  iface: USBInterface
  epIn: number | null
  epOut: number | null
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Request a device via the WebUSB chooser. MUST be invoked synchronously from
 * a user gesture (click) — any prior `await` longer than the browser's
 * transient activation window (~5s) will cause the chooser to refuse to open.
 */
export function requestDeviceInteractive (vid: number, pid: number): Promise<USBDevice> {
  return navigator.usb.requestDevice({ filters: [{ vendorId: vid, productId: pid }] })
}

/**
 * Find an already-authorized device. Use this AFTER a previous successful
 * `requestDevice` call to retrieve the device on subsequent re-enumerations
 * without prompting the user again.
 */
export async function getAuthorizedDevice (vid: number, pid: number): Promise<USBDevice | null> {
  const list = await navigator.usb.getDevices()
  return list.find(d => d.vendorId === vid && d.productId === pid) ?? null
}

/**
 * Poll `getDevices()` until an authorized device of the given VID/PID appears.
 * Does NOT prompt the user; the device must have been authorized previously.
 */
export async function awaitAuthorizedDevice (
  vid: number,
  pid: number,
  timeoutMs: number,
): Promise<USBDevice> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = await getAuthorizedDevice(vid, pid)
    if (found) {
      return found
    }
    await sleep(500)
  }
  throw new Error(`等待 USB 设备超时 (vid=0x${vid.toString(16).padStart(4, '0')} pid=0x${pid.toString(16).padStart(4, '0')})`)
}

function findBulkEndpoints (iface: USBInterface): BulkEndpoints | null {
  let epIn: number | null = null
  let epOut: number | null = null
  for (const ep of iface.alternate.endpoints) {
    if (ep.type !== 'bulk') {
      continue
    }
    if (ep.direction === 'in') {
      epIn = ep.endpointNumber
    }
    if (ep.direction === 'out') {
      epOut = ep.endpointNumber
    }
  }
  if (epIn == null || epOut == null) {
    return null
  }
  return { epIn, epOut }
}

function pickInterface (device: USBDevice, requireBulk: boolean): USBInterface | null {
  const config = device.configuration
  if (!config) {
    return null
  }

  const candidates: USBInterface[] = []
  for (const iface of config.interfaces) {
    candidates.push(iface)
  }

  if (requireBulk) {
    for (const iface of candidates) {
      if (findBulkEndpoints(iface)) {
        return iface
      }
    }
  }

  for (const iface of candidates) {
    const alt = iface.alternate
    if (alt.interfaceClass === 0xfe && alt.interfaceSubclass === 1) {
      return iface
    }
  }

  return candidates[0] ?? null
}

export async function openUsbDevice (
  device: USBDevice,
  options: { requireBulk?: boolean, claimInterface?: boolean } = {},
): Promise<OpenedUsb> {
  const requireBulk = options.requireBulk ?? true
  const shouldClaim = options.claimInterface ?? true

  if (!device.opened) {
    await device.open()
  }
  if (device.configuration == null) {
    await device.selectConfiguration(1)
  }

  const iface = pickInterface(device, requireBulk)
  if (!iface) {
    throw new Error('找不到合适的 USB interface')
  }

  if (shouldClaim) {
    await device.claimInterface(iface.interfaceNumber)
  }

  const bulk = findBulkEndpoints(iface)
  if (requireBulk && !bulk) {
    if (shouldClaim) {
      await device.releaseInterface(iface.interfaceNumber)
    }
    throw new Error('未找到 BULK in/out 端点')
  }

  return {
    device,
    iface,
    epIn: bulk?.epIn ?? null,
    epOut: bulk?.epOut ?? null,
  }
}

export async function closeUsb (opened: OpenedUsb, release = true): Promise<void> {
  try {
    if (release && opened.device.opened) {
      await opened.device.releaseInterface(opened.iface.interfaceNumber)
    }
    if (opened.device.opened) {
      await opened.device.close()
    }
  } catch {
    // ignore close errors
  }
}

/**
 * Open the FEL device, prompting the user via WebUSB chooser if needed.
 * MUST be called synchronously from a user gesture.
 */
export async function connectFelInteractive (): Promise<OpenedUsb> {
  const existing = await getAuthorizedDevice(FEL_VENDOR_ID, FEL_PRODUCT_ID)
  const device = existing ?? await requestDeviceInteractive(FEL_VENDOR_ID, FEL_PRODUCT_ID)
  return openUsbDevice(device, { requireBulk: true, claimInterface: true })
}

/**
 * Open the DFU device, prompting the user via WebUSB chooser if needed.
 * MUST be called synchronously from a user gesture.
 */
export async function connectDfuInteractive (): Promise<OpenedUsb> {
  const existing = await getAuthorizedDevice(DFU_VENDOR_ID, DFU_PRODUCT_ID)
  const device = existing ?? await requestDeviceInteractive(DFU_VENDOR_ID, DFU_PRODUCT_ID)
  return openUsbDevice(device, { requireBulk: false, claimInterface: false })
}

/**
 * 重开 FEL 设备（不弹窗；FEL 设备没重新枚举，授权仍在），并 clearHalt
 * 清掉 bulk 端点可能残留的 STALL。用于 FEL 传输出错后的自动重试。
 */
export async function reopenFel (): Promise<OpenedUsb> {
  const device = await getAuthorizedDevice(FEL_VENDOR_ID, FEL_PRODUCT_ID)
  if (!device) {
    throw new Error('FEL 设备已断开，请重新进入 FEL 模式后再试')
  }
  const opened = await openUsbDevice(device, { requireBulk: true, claimInterface: true })
  try {
    if (opened.epIn != null) {
      await opened.device.clearHalt('in', opened.epIn)
    }
    if (opened.epOut != null) {
      await opened.device.clearHalt('out', opened.epOut)
    }
  } catch {
    // 部分平台对未挂起的端点 clearHalt 会报错，忽略
  }
  return opened
}

/**
 * Wait for an already-authorized DFU device to (re)attach. Use this between
 * the boot/rootfs DFU stages, where the same physical device re-enumerates.
 */
export async function awaitDfuAuthorized (timeoutMs = 60_000): Promise<OpenedUsb> {
  const device = await awaitAuthorizedDevice(DFU_VENDOR_ID, DFU_PRODUCT_ID, timeoutMs)
  return openUsbDevice(device, { requireBulk: false, claimInterface: false })
}

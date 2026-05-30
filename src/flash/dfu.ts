import type { OpenedUsb } from './usbFlash'
import { DFU_TIMEOUT_MS } from './constants'

export const DFU_DETACH = 0
export const DFU_DNLOAD = 1
export const DFU_GETSTATUS = 3
export const DFU_CLRSTATUS = 4
export const DFU_ABORT = 6

export const STATE_DFU_DOWNLOAD_IDLE = 5
export const STATE_DFU_DOWNLOAD_BUSY = 4
export const STATE_DFU_MANIFEST_SYNC = 6
export const STATE_DFU_MANIFEST = 7
export const STATE_DFU_IDLE = 2
export const STATE_DFU_ERROR = 10

const DEFAULT_POLL_TIMEOUT_MS = 100

const DFU_STATUS_NAMES: Record<number, string> = {
  0x00: 'OK',
  0x01: 'errTARGET',
  0x02: 'errFILE',
  0x03: 'errWRITE',
  0x04: 'errERASE',
  0x05: 'errCHECK_ERASED',
  0x06: 'errPROG',
  0x07: 'errVERIFY',
  0x08: 'errADDRESS',
  0x09: 'errNOTDONE',
  0x0a: 'errFIRMWARE',
  0x0b: 'errVENDOR',
  0x0c: 'errUSBR',
  0x0d: 'errPOR',
  0x0e: 'errUNKNOWN',
  0x0f: 'errSTALLEDPKT',
}

const DFU_STATE_NAMES: Record<number, string> = {
  0: 'appIDLE',
  1: 'appDETACH',
  2: 'dfuIDLE',
  3: 'dfuDNLOAD-SYNC',
  4: 'dfuDNLOAD-BUSY',
  5: 'dfuDNLOAD-IDLE',
  6: 'dfuMANIFEST-SYNC',
  7: 'dfuMANIFEST',
  8: 'dfuMANIFEST-WAIT-RESET',
  9: 'dfuUPLOAD-IDLE',
  10: 'dfuERROR',
}

export interface DfuStatus {
  status: number
  pollTimeoutMs: number
  state: number
  iString: number
}

export interface ClaimedDfuInterface {
  interfaceNumber: number
  alternateSetting: number
  interfaceName: string | null
}

export interface DfuAltDescriptor {
  interfaceNumber: number
  alternateSetting: number
  interfaceName: string | null
}

export type DfuLogger = (message: string) => void

const USB_DT_CONFIGURATION = 0x02
const USB_DT_STRING = 0x03
const USB_DT_INTERFACE = 0x04
const USB_REQ_GET_DESCRIPTOR = 0x06

/**
 * Read the active configuration descriptor in raw bytes. WebUSB does not
 * always populate `USBAlternateInterface.interfaceName` (Chromium can leave
 * it null when the underlying string descriptors were never fetched), so we
 * fetch the raw descriptor and extract the strings ourselves.
 */
async function readConfigDescriptor (device: USBDevice): Promise<Uint8Array | null> {
  try {
    const head = await device.controlTransferIn({
      requestType: 'standard',
      recipient: 'device',
      request: USB_REQ_GET_DESCRIPTOR,
      value: USB_DT_CONFIGURATION << 8,
      index: 0,
    }, 9)
    if (head.status !== 'ok' || !head.data || head.data.byteLength < 9) {
      return null
    }
    const totalLength = head.data.getUint16(2, true)
    const full = await device.controlTransferIn({
      requestType: 'standard',
      recipient: 'device',
      request: USB_REQ_GET_DESCRIPTOR,
      value: USB_DT_CONFIGURATION << 8,
      index: 0,
    }, totalLength)
    if (full.status !== 'ok' || !full.data) {
      return null
    }
    return new Uint8Array(full.data.buffer, full.data.byteOffset, full.data.byteLength)
  } catch {
    return null
  }
}

async function readStringDescriptor (
  device: USBDevice,
  index: number,
  langid = 0x04_09,
): Promise<string | null> {
  if (index === 0) {
    return null
  }
  try {
    const result = await device.controlTransferIn({
      requestType: 'standard',
      recipient: 'device',
      request: USB_REQ_GET_DESCRIPTOR,
      value: (USB_DT_STRING << 8) | index,
      index: langid,
    }, 255)
    if (result.status !== 'ok' || !result.data || result.data.byteLength < 2) {
      return null
    }
    const buf = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
    const len = buf[0]
    if (len < 2 || len > buf.length) {
      return null
    }
    const text = new TextDecoder('utf-16le').decode(buf.subarray(2, len))
    return text.replaceAll(/\0+$/g, '').trim()
  } catch {
    return null
  }
}

interface RawAltInfo {
  interfaceNumber: number
  alternateSetting: number
  iInterface: number
}

function parseAltInfos (descriptor: Uint8Array): RawAltInfo[] {
  const out: RawAltInfo[] = []
  let offset = 0
  while (offset + 1 < descriptor.length) {
    const len = descriptor[offset]
    const type = descriptor[offset + 1]
    if (len === 0) {
      break
    }
    if (type === USB_DT_INTERFACE && len >= 9 && offset + len <= descriptor.length) {
      out.push({
        interfaceNumber: descriptor[offset + 2],
        alternateSetting: descriptor[offset + 3],
        iInterface: descriptor[offset + 8],
      })
    }
    offset += len
  }
  return out
}

/**
 * Resolve the human-readable name for each (interface, alt) pair by reading
 * raw USB string descriptors. Returns a map keyed by `${ifaceNumber}/${alt}`.
 */
async function resolveAltNames (
  device: USBDevice,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const descriptor = await readConfigDescriptor(device)
  if (!descriptor) {
    return result
  }
  const alts = parseAltInfos(descriptor)
  const cache = new Map<number, string | null>()
  for (const alt of alts) {
    if (alt.iInterface === 0) {
      continue
    }
    let name = cache.get(alt.iInterface)
    if (name === undefined) {
      name = await readStringDescriptor(device, alt.iInterface)
      cache.set(alt.iInterface, name)
    }
    if (name) {
      result.set(`${alt.interfaceNumber}/${alt.alternateSetting}`, name)
    }
  }
  return result
}

export class DfuClient {
  private transaction = 0

  constructor (
    private readonly device: USBDevice,
    private readonly interfaceNumber: number,
    private readonly timeoutMs = DFU_TIMEOUT_MS,
  ) {}

  async download (data: Uint8Array | null): Promise<void> {
    const payload = data ?? new Uint8Array(0)
    await this.controlOut(DFU_DNLOAD, this.transaction & 0xff_ff, payload)
    this.transaction += 1
  }

  async getStatus (): Promise<DfuStatus> {
    const result = await this.device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request: DFU_GETSTATUS,
      value: 0,
      index: this.interfaceNumber,
    }, 6)
    if (result.status !== 'ok' || !result.data || result.data.byteLength !== 6) {
      throw new Error(`DFU getStatus failed: ${result.status}`)
    }
    const buf = new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    )
    const poll = buf[1] | (buf[2] << 8) | (buf[3] << 16)
    return {
      status: buf[0],
      pollTimeoutMs: poll,
      state: buf[4],
      iString: buf[5],
    }
  }

  async clearStatus (): Promise<void> {
    await this.controlOut(DFU_CLRSTATUS, 0, null)
  }

  async abort (): Promise<void> {
    await this.controlOut(DFU_ABORT, 0, null)
  }

  resetTransaction (): void {
    this.transaction = 0
  }

  private async controlOut (
    request: number,
    value: number,
    data: Uint8Array | null,
  ): Promise<void> {
    let payload: BufferSource | undefined
    if (data && data.byteLength > 0) {
      // Copy to a fresh ArrayBuffer to avoid any WebUSB quirks with shared
      // buffers (e.g. subarray views) and to keep the bytes alive across
      // the async transfer.
      const copy = new Uint8Array(data.byteLength)
      copy.set(data)
      payload = copy
    }
    const result = await this.device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request,
      value,
      index: this.interfaceNumber,
    }, payload)
    if (result.status !== 'ok') {
      throw new Error(`DFU control out failed: ${result.status}`)
    }
  }
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function describeDfuStatus (status: DfuStatus): string {
  const stateName = DFU_STATE_NAMES[status.state] ?? `state=0x${status.state.toString(16)}`
  const codeName = DFU_STATUS_NAMES[status.status] ?? `code=0x${status.status.toString(16)}`
  return `${stateName} (${codeName})`
}

export async function listDfuAlts (opened: OpenedUsb): Promise<DfuAltDescriptor[]> {
  const config = opened.device.configuration
  if (!config) {
    return []
  }
  const nameMap = await resolveAltNames(opened.device)
  const out: DfuAltDescriptor[] = []
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === 0xfe && alt.interfaceSubclass === 1) {
        const key = `${iface.interfaceNumber}/${alt.alternateSetting}`
        const resolved = nameMap.get(key) ?? alt.interfaceName ?? null
        out.push({
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          interfaceName: resolved,
        })
      }
    }
  }
  return out
}

export async function findAndClaimDfuAlt (
  opened: OpenedUsb,
  altName: string,
  log?: DfuLogger,
): Promise<ClaimedDfuInterface> {
  const device = opened.device
  const config = device.configuration
  if (!config) {
    throw new Error('No USB configuration')
  }

  // DFU devices typically expose one USB interface with multiple alternate
  // settings (one per writable partition: boot, rootfs, ...). WebUSB returns
  // them via `iface.alternates`, NOT `iface.alternate` (which is the *active*
  // alt only). We therefore iterate every (interface, alternate) pair.
  const candidates: {
    iface: USBInterface
    alt: USBAlternateInterface
    resolvedName: string | null
  }[] = []
  const nameMap = await resolveAltNames(device)
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === 0xfe && alt.interfaceSubclass === 1) {
        const key = `${iface.interfaceNumber}/${alt.alternateSetting}`
        const resolvedName = nameMap.get(key) ?? alt.interfaceName ?? null
        candidates.push({ iface, alt, resolvedName })
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error('No DFU interfaces found')
  }

  if (log) {
    const summary = candidates.map(c =>
      `iface=${c.iface.interfaceNumber}/alt=${c.alt.alternateSetting}/name=${c.resolvedName ?? '<none>'}`,
    ).join('; ')
    log(`DFU alts available: ${summary}`)
  }

  const wanted = altName.trim().toLowerCase()
  let matched = candidates.find(c => (c.resolvedName ?? '').trim().toLowerCase() === wanted)
  if (!matched) {
    // Fallback when the device does not expose interface string descriptors.
    // This matches our hardware's actual DFU alt layout:
    //   alt 0 -> SPL/u-boot stage (skipped during regular flash)
    //   alt 1 -> boot
    //   alt 2 -> rootfs
    // It is also tolerant of the older 2-alt layout (alt 0 = boot, alt 1 = rootfs).
    const altSettings = new Set(candidates.map(c => c.alt.alternateSetting))
    const fallbackSetting = altName === 'boot'
      ? (altSettings.has(1) ? 1 : 0)
      : (altSettings.has(2) ? 2 : 1)
    matched = candidates.find(c => c.alt.alternateSetting === fallbackSetting)
    if (matched) {
      log?.(`DFU alt name not found, falling back to alternate setting ${fallbackSetting}`)
    }
  }
  if (!matched) {
    throw new Error(`DFU alt setting not found: ${altName}`)
  }

  const ifaceNumber = matched.iface.interfaceNumber
  const altSetting = matched.alt.alternateSetting
  // claimInterface MUST happen before selectAlternateInterface in WebUSB,
  // otherwise Chromium throws "The specified interface has not been claimed".
  if (!matched.iface.claimed) {
    await device.claimInterface(ifaceNumber)
  }
  await device.selectAlternateInterface(ifaceNumber, altSetting)

  log?.(`DFU selected: iface=${ifaceNumber} alt=${altSetting} name=${matched.resolvedName ?? '<none>'}`)

  return {
    interfaceNumber: ifaceNumber,
    alternateSetting: altSetting,
    interfaceName: matched.resolvedName,
  }
}

export async function releaseDfuInterface (
  device: USBDevice,
  claimed: ClaimedDfuInterface,
): Promise<void> {
  try {
    await device.releaseInterface(claimed.interfaceNumber)
  } catch {
    // ignore
  }
}

/**
 * Bring the DFU device into a clean dfuIDLE state. This is required before
 * starting a fresh DNLOAD sequence in case the device is sitting in dfuERROR
 * (e.g. from a prior aborted transfer).
 */
export async function ensureDfuIdle (
  client: DfuClient,
  log?: DfuLogger,
): Promise<DfuStatus> {
  let status = await client.getStatus()
  log?.(`DFU initial status: ${describeDfuStatus(status)}`)
  if (status.state === STATE_DFU_ERROR) {
    await client.clearStatus()
    status = await client.getStatus()
    log?.(`DFU after clearStatus: ${describeDfuStatus(status)}`)
  }
  if (status.state === STATE_DFU_DOWNLOAD_IDLE
    || status.state === STATE_DFU_DOWNLOAD_BUSY) {
    await client.abort()
    status = await client.getStatus()
    log?.(`DFU after abort: ${describeDfuStatus(status)}`)
  }
  return status
}

export async function downloadDfuImage (
  device: USBDevice,
  ifaceNumber: number,
  data: Uint8Array,
  transferSize = 2048,
  onProgress: (done: number, total: number) => void = () => {},
  log?: DfuLogger,
): Promise<void> {
  const client = new DfuClient(device, ifaceNumber)
  client.resetTransaction()
  await ensureDfuIdle(client, log)

  let sent = 0
  while (sent < data.length) {
    const chunkSize = Math.min(transferSize, data.length - sent)
    const chunk = data.subarray(sent, sent + chunkSize)
    await client.download(chunk)
    sent += chunkSize
    await waitUntilDownloadIdle(client, log)
    onProgress(sent, data.length)
  }
  await client.download(null)
  await waitManifest(client, log)
}

async function waitUntilDownloadIdle (client: DfuClient, log?: DfuLogger): Promise<void> {
  while (true) {
    const status = await client.getStatus()
    if (status.state === STATE_DFU_DOWNLOAD_IDLE) {
      return
    }
    if (status.state === STATE_DFU_ERROR) {
      const message = `DFU device entered error state: ${describeDfuStatus(status)}`
      log?.(message)
      await client.clearStatus()
      throw new Error(message)
    }
    await sleep(Math.max(status.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS))
  }
}

async function waitManifest (client: DfuClient, log?: DfuLogger): Promise<void> {
  while (true) {
    const status = await client.getStatus()
    switch (status.state) {
      case STATE_DFU_MANIFEST_SYNC:
      case STATE_DFU_MANIFEST:
      case STATE_DFU_DOWNLOAD_BUSY: {
        await sleep(Math.max(status.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS))
        break
      }
      case STATE_DFU_IDLE:
      case STATE_DFU_DOWNLOAD_IDLE: {
        return
      }
      case STATE_DFU_ERROR: {
        const message = `DFU manifest failed: ${describeDfuStatus(status)}`
        log?.(message)
        throw new Error(message)
      }
      default: {
        return
      }
    }
  }
}

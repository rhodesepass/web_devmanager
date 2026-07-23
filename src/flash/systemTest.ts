import type { FelClient } from './fel'
import type { SpiNandIdEntry } from './spinandIds'
import { F1c100sChip, SPI_SWAP_BUFFER } from './f1c100s'
import { DDR_PAYLOAD } from './ddrPayload'
import { SPINAND_IDS } from './spinandIds'

/** xfel version 命令返回的 F1C100S/F1C200S/F1C500S 家族 id */
export const F1C_CHIP_ID = 0x00_16_63_00

const PAYLOAD_ADDR = 0x00_00_88_00
// payload 里 dsz = (u32*)0x5c,成功时写入 ('X'<<24)|容量MB
const DDR_MAILBOX = 0x5c
const DDR_MAILBOX_MAGIC = 0x58
const DRAM_BASE = 0x80_00_00_00
const MB = 1024 * 1024

const SPI_CMD_END = 0x00
const SPI_CMD_SELECT = 0x02
const SPI_CMD_DESELECT = 0x03
const SPI_CMD_TXBUF = 0x05
const SPI_CMD_RXBUF = 0x06
const OPCODE_RDID = 0x9f

export interface NandProbeResult {
  status: 'match' | 'unknown' | 'absent'
  /** RDID(带 dummy 字节)读回的原始 4 字节 */
  raw: Uint8Array
  entry: SpiNandIdEntry | null
}

export interface DdrTestResult {
  sizeMb: number
  model: 'F1C100S' | 'F1C200S' | null
  memtestOk: boolean
}

function appendU32 (list: number[], value: number): void {
  list.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

async function spiXfer (
  fel: FelClient,
  chip: F1c100sChip,
  tx: Uint8Array,
  rxLen: number,
): Promise<Uint8Array> {
  await fel.write(SPI_SWAP_BUFFER, tx)
  const command: number[] = [SPI_CMD_SELECT, SPI_CMD_TXBUF]
  appendU32(command, SPI_SWAP_BUFFER)
  appendU32(command, tx.length)
  command.push(SPI_CMD_RXBUF)
  appendU32(command, SPI_SWAP_BUFFER)
  appendU32(command, rxLen)
  command.push(SPI_CMD_DESELECT, SPI_CMD_END)
  await chip.runSpiCommand(new Uint8Array(command))
  return fel.read(SPI_SWAP_BUFFER, rxLen)
}

function matchNandId (raw: Uint8Array): SpiNandIdEntry | null {
  return SPINAND_IDS.find(entry =>
    entry.id.every((byte, i) => raw[i] === byte),
  ) ?? null
}

function isBlank (raw: Uint8Array): boolean {
  return raw.every(b => b === 0x00) || raw.every(b => b === 0xff)
}

export function formatJedecId (raw: Uint8Array): string {
  return [...raw].map(b => b.toString(16).padStart(2, '0')).join(' ')
}

/**
 * 读 SPI NAND 的 JEDEC ID 并对照 xfel 的识别表。
 * 与 xfel 一致:先按「0x9f + dummy」读,匹配不到再按「0x9f 不带 dummy」读一次。
 */
export async function probeSpiNand (fel: FelClient): Promise<NandProbeResult> {
  const chip = new F1c100sChip(fel)
  await chip.initializeSpiRuntime()

  const rawDummy = await spiXfer(fel, chip, new Uint8Array([OPCODE_RDID, 0x00]), 4)
  let entry = matchNandId(rawDummy)
  if (entry) {
    return { status: 'match', raw: rawDummy, entry }
  }
  const rawPlain = await spiXfer(fel, chip, new Uint8Array([OPCODE_RDID]), 4)
  entry = matchNandId(rawPlain)
  if (entry) {
    return { status: 'match', raw: rawPlain, entry }
  }
  if (isBlank(rawDummy) && isBlank(rawPlain)) {
    return { status: 'absent', raw: rawDummy, entry: null }
  }
  return { status: 'unknown', raw: isBlank(rawDummy) ? rawPlain : rawDummy, entry: null }
}

/** 信箱有成功标记后,再从主机侧抽查几个地址,顺便验证容量没有回绕(地址线缺焊时高位地址会别名到低位)。 */
async function verifyDram (fel: FelClient, sizeMb: number): Promise<boolean> {
  const half = DRAM_BASE + (sizeMb / 2) * MB
  const tail = DRAM_BASE + sizeMb * MB - 4
  const probes: Array<[number, number]> = [
    [DRAM_BASE, 0xa5_a5_5a_5a],
    [half, 0x5a_5a_a5_a5],
    [tail, 0x13_57_24_68],
  ]
  for (const [addr, value] of probes) {
    await fel.write32(addr, value)
  }
  for (const [addr, value] of probes) {
    if (await fel.read32(addr) !== value) {
      return false
    }
  }
  // 再确认 base 没有被 half/tail 的写入覆盖(回绕检测)
  return await fel.read32(DRAM_BASE) === 0xa5_a5_5a_5a
}

const LRADC_BASE = 0x01_c2_34_00
const LRADC_CTRL = LRADC_BASE + 0x00
const LRADC_DATA0 = LRADC_BASE + 0x0c

/** vref-supply 3V,sun4i LRADC 内部取 2/3 作满量程 → 2V;6 bit 采样,0..63 */
export const LRADC_VREF_UV = 2_000_000
export const LRADC_MAX_RAW = 63

export interface LradcKey {
  label: string
  /** 设备树 voltage 属性,µV */
  voltage: number
}

/** 各硬件版本的 LRADC 按键电压表(取自 buildroot 设备树 devicetree-<rev>.dts 的 &lradc 节点) */
const LRADC_KEYS: Record<string, LradcKey[]> = {
  0.1: [
    { label: '按键 1', voltage: 0 },
    { label: '按键 2', voltage: 444_444 },
    { label: '按键 3', voltage: 825_396 },
    { label: '按键 4', voltage: 1_111_111 },
    { label: '按键 5', voltage: 1_365_079 },
    { label: '按键 6', voltage: 1_555_555 },
  ],
  0.3: [
    { label: '按键 1', voltage: 1_111_111 },
    { label: '按键 2', voltage: 825_396 },
    { label: '按键 3', voltage: 444_444 },
    { label: '按键 4', voltage: 0 },
  ],
  0.6: [
    { label: '电源键', voltage: 0 },
    { label: '按键 1', voltage: 1_396_826 },
    { label: '按键 2', voltage: 1_111_111 },
    { label: '按键 3', voltage: 825_396 },
    { label: '按键 4', voltage: 444_444 },
  ],
}

export function getLradcKeys (rev: string): LradcKey[] {
  if (rev === '0.2') {
    return LRADC_KEYS['0.1']
  }
  if (rev === '0.5') {
    return LRADC_KEYS['0.3']
  }
  return LRADC_KEYS[rev] ?? LRADC_KEYS['0.6']
}

/** 使能 KEYADC:连续采样、普通 key 模式、250Hz,不开中断,直接轮询 DATA0 */
export async function lradcEnable (fel: FelClient): Promise<void> {
  await fel.write32(LRADC_CTRL, ((2 << 24) | 0x1) >>> 0)
}

export async function lradcDisable (fel: FelClient): Promise<void> {
  await fel.write32(LRADC_CTRL, 0)
}

export async function lradcReadRaw (fel: FelClient): Promise<number> {
  return (await fel.read32(LRADC_DATA0)) & 0x3f
}

export function lradcRawToUv (raw: number): number {
  return Math.round(raw * LRADC_VREF_UV / LRADC_MAX_RAW)
}

/** 与内核 sun4i-lradc-keys 一致:取电压差最小的键;接近满量程视为无按键 */
export function lradcMatchKey (keys: LradcKey[], raw: number): LradcKey | null {
  if (raw >= LRADC_MAX_RAW - 1) {
    return null
  }
  const uv = lradcRawToUv(raw)
  let best: LradcKey | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const key of keys) {
    const diff = Math.abs(key.voltage - uv)
    if (diff < bestDiff) {
      bestDiff = diff
      best = key
    }
  }
  return best
}

/**
 * 上传 xfel 的 DDR 初始化 payload 并执行。payload 自带时钟配置、DDR 控制器初始化、
 * 容量探测与自检,结束后把容量写入 0x5c 信箱并原路返回 FEL,USB 连接不中断。
 */
export async function runDdrTest (fel: FelClient): Promise<DdrTestResult> {
  await fel.write32(DDR_MAILBOX, 0)
  await fel.write(PAYLOAD_ADDR, DDR_PAYLOAD)
  await fel.exec(PAYLOAD_ADDR)

  const mailbox = await fel.read32(DDR_MAILBOX)
  if ((mailbox >>> 24) !== DDR_MAILBOX_MAGIC) {
    throw new Error('DDR 初始化失败:payload 自检未通过(信箱无成功标记)')
  }
  const sizeMb = mailbox & 0xff_ff_ff
  const model = sizeMb === 32 ? 'F1C100S' : (sizeMb === 64 ? 'F1C200S' : null)
  const memtestOk = await verifyDram(fel, sizeMb)
  return { sizeMb, model, memtestOk }
}

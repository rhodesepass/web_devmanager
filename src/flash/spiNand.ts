import type { F1c100sChip } from './f1c100s'
import type { FelClient } from './fel'
import { SPI_SWAP_BUFFER } from './f1c100s'

const SPI_CMD_END = 0x00
const SPI_CMD_SELECT = 0x02
const SPI_CMD_DESELECT = 0x03
const SPI_CMD_FAST = 0x04
const SPI_CMD_TXBUF = 0x05
const SPI_CMD_RXBUF = 0x06
const SPI_CMD_SPINAND_WAIT = 0x08

const OPCODE_RDID = 0x9f
const OPCODE_GET_FEATURE = 0x0f
const OPCODE_SET_FEATURE = 0x1f
const OPCODE_FEATURE_PROTECT = 0xa0
const OPCODE_WRITE_ENABLE = 0x06
const OPCODE_BLOCK_ERASE = 0xd8
const OPCODE_PROGRAM_LOAD = 0x02
const OPCODE_PROGRAM_EXEC = 0x10
const OPCODE_RESET = 0xff

export interface SpiNandInfo {
  name: string
  id: Uint8Array
  pageSize: number
  pagesPerBlock: number
}

export interface SpiNandContext {
  info: SpiNandInfo
}

type ProgressCb = (done: number, total: number) => void

const INFOS: SpiNandInfo[] = [
  { name: 'W25N01GV', id: new Uint8Array([0xef, 0xaa, 0x21]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'W25N01KV', id: new Uint8Array([0xef, 0xae, 0x21]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'GD5F1GQ4UAWxx', id: new Uint8Array([0xc8, 0x10]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'GD5F1GQ5UExxG', id: new Uint8Array([0xc8, 0x51]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'MX35LF1GE4AB', id: new Uint8Array([0xc2, 0x12]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'MT29F1G01AAADD', id: new Uint8Array([0x2c, 0x12]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'TC58CVG0S3HRAIG', id: new Uint8Array([0x98, 0xc2]), pageSize: 2048, pagesPerBlock: 64 },
  { name: 'F35SQA001G', id: new Uint8Array([0xcd, 0x71, 0x71]), pageSize: 2048, pagesPerBlock: 64 },
]

function matchesId (read: Uint8Array, expected: Uint8Array): boolean {
  if (read.length < expected.length) {
    return false
  }
  for (const [i, byte] of expected.entries()) {
    if (read[i] !== byte) {
      return false
    }
  }
  return true
}

function appendU32 (list: number[], value: number): void {
  list.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

export class SpiNand {
  constructor (
    private readonly fel: FelClient,
    private readonly chip: F1c100sChip,
  ) {}

  async initialize (): Promise<SpiNandContext> {
    await this.chip.initializeSpiRuntime()
    const info = await this.detectInfo()
    if (!info) {
      throw new Error('Unsupported SPI NAND')
    }
    await this.reset()
    await this.waitBusy()
    const protect = (await this.getFeature(OPCODE_FEATURE_PROTECT))[0]
    if (protect !== 0) {
      await this.setFeature(OPCODE_FEATURE_PROTECT, 0)
      await this.waitBusy()
    }
    return { info }
  }

  async erase (
    ctx: SpiNandContext,
    address: number,
    length: number,
    onProgress: ProgressCb = () => {},
  ): Promise<void> {
    const eraseSize = ctx.info.pageSize * ctx.info.pagesPerBlock
    const alignedStart = address - (address % eraseSize)
    let remaining = length + (address - alignedStart)
    if (remaining % eraseSize !== 0) {
      remaining += eraseSize - (remaining % eraseSize)
    }
    let current = alignedStart
    let done = 0
    while (remaining > 0) {
      await this.eraseBlock(current, ctx.info.pageSize)
      current += eraseSize
      remaining -= eraseSize
      done += eraseSize
      onProgress(done, done + remaining)
    }
  }

  async write (
    ctx: SpiNandContext,
    address: number,
    data: Uint8Array,
    onProgress: ProgressCb = () => {},
  ): Promise<void> {
    const eraseSize = ctx.info.pageSize * ctx.info.pagesPerBlock
    const alignedStart = Math.floor(address / eraseSize) * eraseSize
    let totalErase = data.length + (address - alignedStart)
    if (totalErase % eraseSize !== 0) {
      totalErase += eraseSize - (totalErase % eraseSize)
    }
    const totalWork = totalErase + data.length
    await this.erase(ctx, alignedStart, totalErase, done => {
      onProgress(done, totalWork)
    })

    let offset = 0
    let addr = address
    while (offset < data.length) {
      const chunk = Math.min(64 * 1024, data.length - offset)
      await this.writeChunk(ctx, addr, data, offset, chunk)
      offset += chunk
      addr += chunk
      onProgress(totalErase + offset, totalWork)
    }
  }

  private async detectInfo (): Promise<SpiNandInfo | null> {
    const id1 = await this.xfer(new Uint8Array([OPCODE_RDID, 0x00]), 4)
    const found1 = INFOS.find(info => matchesId(id1, info.id))
    if (found1) {
      return found1
    }
    const id = await this.xfer(new Uint8Array([OPCODE_RDID]), 4)
    return INFOS.find(info => matchesId(id, info.id)) ?? null
  }

  private async reset (): Promise<void> {
    await this.xfer(new Uint8Array([OPCODE_RESET]), 0)
  }

  private async getFeature (addr: number): Promise<Uint8Array> {
    return this.xfer(new Uint8Array([OPCODE_GET_FEATURE, addr]), 1)
  }

  private async setFeature (addr: number, value: number): Promise<void> {
    await this.xfer(new Uint8Array([OPCODE_SET_FEATURE, addr, value]), 0)
  }

  private async waitBusy (): Promise<void> {
    await this.runCommand(new Uint8Array([
      SPI_CMD_SELECT, SPI_CMD_SPINAND_WAIT, SPI_CMD_DESELECT, SPI_CMD_END,
    ]))
  }

  private async eraseBlock (address: number, pageSize: number): Promise<void> {
    const pageAddress = Math.floor(address / pageSize)
    const cmd = new Uint8Array([
      SPI_CMD_SELECT, SPI_CMD_FAST, 1, OPCODE_WRITE_ENABLE,
      SPI_CMD_DESELECT,
      SPI_CMD_SELECT, SPI_CMD_SPINAND_WAIT, SPI_CMD_DESELECT,
      SPI_CMD_SELECT, SPI_CMD_FAST, 4,
      OPCODE_BLOCK_ERASE,
      (pageAddress >>> 16) & 0xff, (pageAddress >>> 8) & 0xff, pageAddress & 0xff,
      SPI_CMD_DESELECT,
      SPI_CMD_SELECT, SPI_CMD_SPINAND_WAIT, SPI_CMD_DESELECT,
      SPI_CMD_END,
    ])
    await this.runCommand(cmd)
  }

  private async writeChunk (
    ctx: SpiNandContext,
    address: number,
    source: Uint8Array,
    sourceOffset: number,
    chunkSize: number,
  ): Promise<void> {
    let localAddr = address
    let offset = sourceOffset
    let remaining = chunkSize
    while (remaining > 0) {
      const pageAddress = Math.floor(localAddr / ctx.info.pageSize)
      const column = localAddr & (ctx.info.pageSize - 1)
      const n = Math.min(remaining, ctx.info.pageSize - column)
      const tx = new Uint8Array(3 + n)
      tx[0] = OPCODE_PROGRAM_LOAD
      tx[1] = (column >>> 8) & 0xff
      tx[2] = column & 0xff
      tx.set(source.subarray(offset, offset + n), 3)

      const command: number[] = [
        SPI_CMD_SELECT, SPI_CMD_FAST, 1, OPCODE_WRITE_ENABLE,
        SPI_CMD_DESELECT,
        SPI_CMD_SELECT, SPI_CMD_SPINAND_WAIT, SPI_CMD_DESELECT,
        SPI_CMD_SELECT, SPI_CMD_TXBUF,
      ]
      appendU32(command, SPI_SWAP_BUFFER)
      appendU32(command, tx.length)
      command.push(SPI_CMD_DESELECT, SPI_CMD_SELECT, SPI_CMD_SPINAND_WAIT, SPI_CMD_DESELECT,
        SPI_CMD_SELECT, SPI_CMD_FAST, 4,
        OPCODE_PROGRAM_EXEC,
        (pageAddress >>> 16) & 0xff, (pageAddress >>> 8) & 0xff, pageAddress & 0xff,
        SPI_CMD_DESELECT,
        SPI_CMD_SELECT, SPI_CMD_SPINAND_WAIT, SPI_CMD_DESELECT,
        SPI_CMD_END,
      )

      await this.fel.write(SPI_SWAP_BUFFER, tx)
      await this.runCommand(new Uint8Array(command))

      localAddr += n
      offset += n
      remaining -= n
    }
  }

  private async xfer (tx: Uint8Array, rxLen: number): Promise<Uint8Array> {
    if (tx.length > 3584 || rxLen > 3584) {
      throw new Error('SPI transfer too large')
    }
    if (tx.length > 0) {
      await this.fel.write(SPI_SWAP_BUFFER, tx)
    }
    const command: number[] = [SPI_CMD_SELECT]
    if (tx.length > 0) {
      command.push(SPI_CMD_TXBUF)
      appendU32(command, SPI_SWAP_BUFFER)
      appendU32(command, tx.length)
    }
    if (rxLen > 0) {
      command.push(SPI_CMD_RXBUF)
      appendU32(command, SPI_SWAP_BUFFER)
      appendU32(command, rxLen)
    }
    command.push(SPI_CMD_DESELECT, SPI_CMD_END)
    await this.runCommand(new Uint8Array(command))
    return rxLen > 0 ? await this.fel.read(SPI_SWAP_BUFFER, rxLen) : new Uint8Array(0)
  }

  private async runCommand (command: Uint8Array): Promise<void> {
    if (command.length > 4096) {
      throw new Error('SPI command too large')
    }
    await this.chip.runSpiCommand(command)
  }
}

import type { FelClient } from './fel'
import { SPI_PAYLOAD } from './spiPayload'

export const SPI_SWAP_BUFFER = 0x00_00_A8_00
export const SPI_SWAP_LENGTH = 3584
export const SPI_CMD_LENGTH = 4096

const SPI_CMD_INIT = 0x01
const SPI_CMD_END = 0x00
const PAYLOAD_ADDR = 0x00_00_88_00
const CMD_ADDR = 0x00_00_98_00

export class F1c100sChip {
  constructor (private readonly fel: FelClient) {}

  async resetWithWatchdog (): Promise<void> {
    const regBase = 0x01_c2_0c_a0
    let value = await this.fel.read32(regBase + 0x18)
    value = value & ~((0xF << 4) >>> 0)
    value = (value | (1 << 4) | 0x1) >>> 0
    await this.fel.write32(regBase + 0x18, value)
    await this.fel.write32(regBase + 0x10, ((0xA_57 << 1) | 0x1) >>> 0)
  }

  async initializeSpiRuntime (): Promise<void> {
    if (SPI_PAYLOAD.length === 0) {
      throw new Error('SPI payload missing')
    }
    await this.fel.write(PAYLOAD_ADDR, SPI_PAYLOAD)
    await this.runSpiCommand(new Uint8Array([SPI_CMD_INIT, SPI_CMD_END]))
  }

  async runSpiCommand (commandBuffer: Uint8Array): Promise<void> {
    if (commandBuffer.length > SPI_CMD_LENGTH) {
      throw new Error('SPI command too large')
    }
    await this.fel.write(CMD_ADDR, commandBuffer)
    await this.fel.exec(PAYLOAD_ADDR)
  }
}

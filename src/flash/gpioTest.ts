import type { FelClient } from './fel'

export interface TestPin {
  key: string
  signal: string
  pinName: string
  bank: number
  pin: number
}

const PIO_BASE = 0x01_c2_08_00
const BANK_STEP = 0x24

function pinName (bank: number, pin: number): string {
  return `P${String.fromCodePoint(65 + bank)}${pin}`
}

function mkPin (key: string, signal: string, bank: number, pin: number): TestPin {
  return { key, signal, pinName: pinName(bank, pin), bank, pin }
}

// sda/cs 随硬件版本迁移,其余脚全版本一致
const VARIABLE: Record<string, { sda: [number, number], cs: [number, number] }> = {
  0.1: { sda: [4, 3], cs: [4, 2] },
  0.2: { sda: [4, 4], cs: [4, 3] },
  0.3: { sda: [4, 4], cs: [4, 3] },
  0.5: { sda: [4, 4], cs: [4, 11] },
  0.6: { sda: [4, 4], cs: [4, 11] },
}

export const SUPPORTED_REVS = ['0.1', '0.2', '0.3', '0.5', '0.6'] as const

export function getTestPins (rev: string): TestPin[] {
  const v = VARIABLE[rev] ?? VARIABLE['0.6']
  return [
    mkPin('sda', 'sda', v.sda[0], v.sda[1]),
    mkPin('scl', 'scl', 3, 19),
    mkPin('cs', 'cs', v.cs[0], v.cs[1]),
    mkPin('pclk', 'PCLK', 3, 18),
    mkPin('hs', 'HS', 3, 20),
    mkPin('vs', 'VS', 3, 21),
    mkPin('pwm0', 'PWM0', 4, 12),
  ]
}

/**
 * 直接通过 FEL 读改写 F1C100s 的 PIO 寄存器切换单个引脚电平。
 * 寄存器布局同 sunxi-tools pio.c:每 bank 步长 0x24,CFG 每脚 3 bit,DATA 每脚 1 bit。
 */
export class GpioTester {
  constructor (private readonly fel: FelClient) {}

  async configOutput (pin: TestPin): Promise<void> {
    const { cfgAddr, cfgShift } = this.regs(pin)
    let cfg = await this.fel.read32(cfgAddr)
    cfg = (cfg & ~((0x7 << cfgShift) >>> 0)) >>> 0
    cfg = (cfg | ((0x1 << cfgShift) >>> 0)) >>> 0
    await this.fel.write32(cfgAddr, cfg)
  }

  async setLevel (pin: TestPin, high: boolean): Promise<void> {
    const { dataAddr } = this.regs(pin)
    const mask = (1 << pin.pin) >>> 0
    let data = await this.fel.read32(dataAddr)
    data = high ? (data | mask) >>> 0 : (data & ~mask) >>> 0
    await this.fel.write32(dataAddr, data)
  }

  private regs (pin: TestPin) {
    const bankBase = PIO_BASE + pin.bank * BANK_STEP
    return {
      cfgAddr: bankBase + (pin.pin >> 3) * 4,
      cfgShift: (pin.pin & 7) * 4,
      dataAddr: bankBase + 0x10,
    }
  }
}

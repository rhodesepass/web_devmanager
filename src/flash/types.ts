export type FlashEvent
  = | { type: 'step', title: string }
    | { type: 'progress', done: number, total: number }
    | { type: 'log', message: string }
    | { type: 'waiting', mode: string }
    | { type: 'done' }
    | { type: 'failed', reason: string }

export interface FlashFiles {
  /** 新方法：FEL 阶段载入内存执行的 u-boot.bin */
  felboot: Uint8Array
  uboot: Uint8Array
  boot: Uint8Array
  rootfs: Uint8Array
}

export interface FlashSelection {
  rev: string
  screen: string
}

/** new = FEL 载入 u-boot + DFU 三分区（flash.py 方案）；legacy = FEL 直写 SPI NAND */
export type FlashMethod = 'new' | 'legacy'

/** nand = 系统盘启动(boot_type 0x01)；sd = 数据盘/SD 卡启动(boot_type 0x02) */
export type FlashTarget = 'nand' | 'sd'

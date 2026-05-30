export type FlashEvent
  = | { type: 'step', title: string }
    | { type: 'progress', done: number, total: number }
    | { type: 'log', message: string }
    | { type: 'waiting', mode: string }
    | { type: 'done' }
    | { type: 'failed', reason: string }

export interface FlashFiles {
  uboot: Uint8Array
  boot: Uint8Array
  rootfs: Uint8Array
}

export interface FlashSelection {
  rev: string
  screen: string
}

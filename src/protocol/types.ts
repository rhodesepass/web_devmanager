import type { MsgType } from './constants'

export interface Frame {
  type: MsgType
  requestId: number
  flags: number
  payload: Uint8Array
}

export interface CommandResult {
  exitCode: number
  timedOut: boolean
  durationMs: number
  stdout: Uint8Array
  stderr: Uint8Array
}

export type KvMap = Record<string, string>

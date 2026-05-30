import { MsgType } from './constants'
import { decodeKv } from './kv'
import { decodeCommandResult } from './command'
import type { Frame } from './types'

const MSG_TYPE_NAMES: Record<number, string> = {
  [MsgType.HELLO]: 'HELLO',
  [MsgType.STATUS]: 'STATUS',
  [MsgType.ERROR]: 'ERROR',
  [MsgType.FILE_PUT_BEGIN]: 'FILE_PUT_BEGIN',
  [MsgType.FILE_PUT_CHUNK]: 'FILE_PUT_CHUNK',
  [MsgType.FILE_PUT_END]: 'FILE_PUT_END',
  [MsgType.FILE_GET]: 'FILE_GET',
  [MsgType.FILE_LIST]: 'FILE_LIST',
  [MsgType.FILE_DELETE]: 'FILE_DELETE',
  [MsgType.FILE_RENAME]: 'FILE_RENAME',
  [MsgType.FILE_MKDIR]: 'FILE_MKDIR',
  [MsgType.FILE_STAT]: 'FILE_STAT',
  [MsgType.COMMAND_EXEC]: 'COMMAND_EXEC',
  [MsgType.COMMAND_RESULT]: 'COMMAND_RESULT',
  [MsgType.DEVINFO]: 'DEVINFO',
}

const KV_MSG_TYPES = new Set<MsgType>([
  MsgType.HELLO,
  MsgType.STATUS,
  MsgType.ERROR,
  MsgType.DEVINFO,
  MsgType.FILE_PUT_BEGIN,
  MsgType.FILE_LIST,
  MsgType.FILE_STAT,
  MsgType.FILE_GET,
  MsgType.FILE_DELETE,
  MsgType.FILE_RENAME,
  MsgType.FILE_MKDIR,
])

const MAX_HEX_BYTES = 64

function msgTypeName (type: MsgType): string {
  return MSG_TYPE_NAMES[type] ?? `UNKNOWN(${type})`
}

function hexPreview (data: Uint8Array, max = MAX_HEX_BYTES): string {
  const n = Math.min(data.length, max)
  const hex = Array.from(data.subarray(0, n), b => b.toString(16).padStart(2, '0')).join(' ')
  return data.length > max ? `${hex} … (+${data.length - max} bytes)` : hex
}

function decodePayloadSummary (type: MsgType, payload: Uint8Array): unknown {
  if (payload.length === 0) return undefined

  if (KV_MSG_TYPES.has(type)) {
    try {
      return decodeKv(payload)
    } catch {
      /* fall through */
    }
  }

  if (type === MsgType.FILE_PUT_CHUNK || type === MsgType.FILE_PUT_END) {
    if (payload.length >= 4) {
      const rid = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true)
      return { requestId: rid, dataBytes: Math.max(0, payload.length - 4) }
    }
  }

  if (type === MsgType.COMMAND_EXEC && payload.length >= 16) {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const cmdLen = dv.getUint32(12, true)
    const cmd = new TextDecoder().decode(payload.subarray(16, 16 + cmdLen))
    return {
      timeoutMs: dv.getUint32(0, true),
      maxStdout: dv.getUint32(4, true),
      maxStderr: dv.getUint32(8, true),
      command: cmd.length > 200 ? `${cmd.slice(0, 200)}…` : cmd,
    }
  }

  if (type === MsgType.COMMAND_RESULT) {
    try {
      const r = decodeCommandResult(payload)
      return {
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        stdoutBytes: r.stdout.length,
        stderrBytes: r.stderr.length,
      }
    } catch {
      /* fall through */
    }
  }

  if (type === MsgType.FILE_GET && payload.length > 256) {
    return { binaryBytes: payload.length }
  }

  return { hex: hexPreview(payload) }
}

export function logUsbProtocolFrame (direction: 'TX' | 'RX', frame: Pick<Frame, 'type' | 'requestId' | 'flags' | 'payload'>): void {
  if (!import.meta.env.DEV) return

  const type = frame.type
  const summary = decodePayloadSummary(type, frame.payload)
  const label = `[USB ${direction}] ${msgTypeName(type)}`

  console.groupCollapsed(
    `%c${label}%c req=${frame.requestId} payload=${frame.payload.length}B`,
    'color:#1976d2;font-weight:bold',
    'color:inherit;font-weight:normal',
  )
  console.log('type:', type, msgTypeName(type))
  console.log('requestId:', frame.requestId)
  if (frame.flags) console.log('flags:', frame.flags)
  console.log('payloadLength:', frame.payload.length)
  if (summary !== undefined) console.log('payload:', summary)
  if (frame.payload.length > 0 && frame.payload.length <= MAX_HEX_BYTES && summary && !('hex' in (summary as object))) {
    console.log('raw:', hexPreview(frame.payload))
  }
  console.groupEnd()
}

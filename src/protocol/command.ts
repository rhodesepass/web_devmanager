import type { CommandResult } from './types'

const encoder = new TextEncoder()

export function encodeCommandExec (
  command: string,
  timeoutMs = 0,
  maxStdout = 0,
  maxStderr = 0,
): Uint8Array {
  const cmdBytes = encoder.encode(command)
  const buf = new Uint8Array(16 + cmdBytes.length)
  const dv = new DataView(buf.buffer)

  dv.setUint32(0, timeoutMs, true)
  dv.setUint32(4, maxStdout, true)
  dv.setUint32(8, maxStderr, true)
  dv.setUint32(12, cmdBytes.length, true)
  buf.set(cmdBytes, 16)

  return buf
}

export function decodeCommandResult (data: Uint8Array): CommandResult {
  if (data.length < 20) {
    throw new Error(`COMMAND_RESULT too short: ${data.length}`)
  }

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const exitCode = dv.getInt32(0, true)
  const timedOut = dv.getUint8(4) !== 0
  // 3 reserved bytes at offset 5
  const durationMs = dv.getUint32(8, true)
  const stdoutLen = dv.getUint32(12, true)
  const stderrLen = dv.getUint32(16, true)

  const total = 20 + stdoutLen + stderrLen
  if (data.length < total) {
    throw new Error(`COMMAND_RESULT payload truncated: need ${total}, got ${data.length}`)
  }

  const stdout = data.slice(20, 20 + stdoutLen)
  const stderr = data.slice(20 + stdoutLen, 20 + stdoutLen + stderrLen)

  return { exitCode, timedOut, durationMs, stdout, stderr }
}

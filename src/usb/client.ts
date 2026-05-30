import {
  MsgType,
  encodeKv,
  decodeKv,
  encodeCommandExec,
  decodeCommandResult,
} from '@/protocol'
import { DEFAULT_FILE_CHUNK } from './constants'
import { UsbTransport } from './transport'
import type { KvMap, CommandResult } from '@/protocol'

export class UsbResponderClient {
  constructor (readonly transport: UsbTransport) {}

  async hello (): Promise<KvMap> {
    const rid = this.transport.nextId()
    await this.transport.sendFrame(MsgType.HELLO, new Uint8Array(0), rid)
    return this.expectKv(rid)
  }

  async devinfo (): Promise<KvMap> {
    const rid = this.transport.nextId()
    await this.transport.sendFrame(MsgType.DEVINFO, new Uint8Array(0), rid)

    const frame = await this.transport.recvFrame()
    if (frame.type === MsgType.ERROR) {
      const kv = decodeKv(frame.payload)
      throw new Error(kv.message ?? 'unknown error')
    }
    if (frame.type !== MsgType.DEVINFO) {
      throw new Error(`unexpected response type: ${frame.type}`)
    }
    return decodeKv(frame.payload)
  }

  async fileList (path: string): Promise<{ files: string[]; dirs: string[] }> {
    const rid = this.transport.nextId()
    const payload = encodeKv([['path', path]])
    await this.transport.sendFrame(MsgType.FILE_LIST, payload, rid)
    const kv = await this.expectKv(rid)
    return {
      files: kv.files ? kv.files.split('\n').filter(Boolean) : [],
      dirs: kv.dirs ? kv.dirs.split('\n').filter(Boolean) : [],
    }
  }

  async fileStat (path: string): Promise<KvMap> {
    const rid = this.transport.nextId()
    const payload = encodeKv([['path', path]])
    await this.transport.sendFrame(MsgType.FILE_STAT, payload, rid)
    return this.expectKv(rid)
  }

  async filePut (
    file: File,
    remotePath: string,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const rid = this.transport.nextId()

    // FILE_PUT_BEGIN
    const beginPayload = encodeKv([['path', remotePath]])
    await this.transport.sendFrame(MsgType.FILE_PUT_BEGIN, beginPayload, rid)
    await this.expectKv(rid)

    // FILE_PUT_CHUNK
    let offset = 0
    while (offset < file.size) {
      const slice = file.slice(offset, offset + DEFAULT_FILE_CHUNK)
      const bytes = new Uint8Array(await slice.arrayBuffer())
      const chunk = new Uint8Array(4 + bytes.length)
      new DataView(chunk.buffer).setUint32(0, rid, true)
      chunk.set(bytes, 4)
      await this.transport.sendFrame(MsgType.FILE_PUT_CHUNK, chunk, rid)
      await this.expectKv(rid)
      offset += DEFAULT_FILE_CHUNK
      onProgress?.(Math.min(offset, file.size), file.size)
    }

    // FILE_PUT_END
    const endPayload = new Uint8Array(4)
    new DataView(endPayload.buffer).setUint32(0, rid, true)
    await this.transport.sendFrame(MsgType.FILE_PUT_END, endPayload, rid)
    await this.expectKv(rid)
  }

  async fileGet (remotePath: string): Promise<Uint8Array> {
    const rid = this.transport.nextId()
    const payload = encodeKv([['path', remotePath]])
    await this.transport.sendFrame(MsgType.FILE_GET, payload, rid)

    const frame = await this.transport.recvFrame()
    if (frame.type === MsgType.ERROR) {
      const kv = decodeKv(frame.payload)
      throw new Error(kv.message ?? 'unknown error')
    }
    if (frame.type !== MsgType.FILE_GET) {
      throw new Error(`unexpected response type: ${frame.type}`)
    }
    return frame.payload
  }

  async fileDelete (path: string): Promise<void> {
    const rid = this.transport.nextId()
    const payload = encodeKv([['path', path]])
    await this.transport.sendFrame(MsgType.FILE_DELETE, payload, rid)
    await this.expectKv(rid)
  }

  async fileRename (from: string, to: string): Promise<void> {
    const rid = this.transport.nextId()
    const payload = encodeKv([['from', from], ['to', to]])
    await this.transport.sendFrame(MsgType.FILE_RENAME, payload, rid)
    await this.expectKv(rid)
  }

  async dirMkdir (path: string, parents = false): Promise<void> {
    const rid = this.transport.nextId()
    const items: [string, string][] = [['path', path]]
    if (parents) items.push(['parents', '1'])
    await this.transport.sendFrame(MsgType.FILE_MKDIR, encodeKv(items), rid)
    await this.expectKv(rid)
  }

  async commandExec (
    command: string,
    options?: { timeoutMs?: number; maxStdout?: number; maxStderr?: number },
  ): Promise<CommandResult> {
    const rid = this.transport.nextId()
    const payload = encodeCommandExec(
      command,
      options?.timeoutMs ?? 30_000,
      options?.maxStdout ?? 1024 * 1024,
      options?.maxStderr ?? 256 * 1024,
    )
    await this.transport.sendFrame(MsgType.COMMAND_EXEC, payload, rid)

    const frame = await this.transport.recvFrame()
    if (frame.type === MsgType.ERROR) {
      const kv = decodeKv(frame.payload)
      throw new Error(kv.message ?? 'unknown error')
    }
    if (frame.type !== MsgType.COMMAND_RESULT) {
      throw new Error(`unexpected response type: ${frame.type}`)
    }
    return decodeCommandResult(frame.payload)
  }

  private async expectKv (reqId: number): Promise<KvMap> {
    const frame = await this.transport.recvFrame()
    if (frame.requestId !== reqId) {
      throw new Error(`request_id mismatch: expected ${reqId}, got ${frame.requestId}`)
    }
    if (frame.type === MsgType.ERROR) {
      const kv = decodeKv(frame.payload)
      throw new Error(kv.message ?? 'unknown error')
    }
    if (frame.type !== MsgType.STATUS) {
      throw new Error(`unexpected response type: ${frame.type}`)
    }
    return decodeKv(frame.payload)
  }
}

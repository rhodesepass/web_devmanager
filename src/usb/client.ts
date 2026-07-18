import {
  MsgType,
  encodeKv,
  decodeKv,
  encodeCommandExec,
  decodeCommandResult,
} from '@/protocol'
import { DEFAULT_FILE_CHUNK, DOWNLOAD_SEGMENT, MAX_PAYLOAD } from './constants'
import { UsbTransport } from './transport'
import type { KvMap, CommandResult, Frame } from '@/protocol'

export class UsbResponderClient {
  constructor (readonly transport: UsbTransport) {}

  // USB 是半双工单通道，一次只能有一个在途的“请求-响应”事务。两个操作并发
  // 交错发帧/收帧会让请求与响应错位、协议永久失步（表现为所有请求卡死无响应）。
  // 这里在客户端层串行化每个 public 方法，等价于 Android 端 repository 的 mutex.withLock。
  // 内部相互调用（filePut→dirMkdir、fileGet→fileStat）走无锁私有实现，避免同一事务自死锁。
  private readonly mutex = new Mutex()

  async hello (): Promise<KvMap> {
    return this.mutex.runExclusive(() =>
      this.requestKv(MsgType.HELLO, new Uint8Array(0)),
    )
  }

  async devinfo (): Promise<KvMap> {
    return this.mutex.runExclusive(() => this.devinfoImpl())
  }

  private async devinfoImpl (): Promise<KvMap> {
    const rid = this.transport.nextId()
    await this.transport.sendFrame(MsgType.DEVINFO, new Uint8Array(0), rid)
    const frame = await this.recvResponse(rid, MsgType.DEVINFO)
    return decodeKv(frame.payload)
  }

  async fileList (path: string): Promise<{ files: string[]; dirs: string[] }> {
    return this.mutex.runExclusive(async () => {
      const kv = await this.requestKv(MsgType.FILE_LIST, encodeKv([['path', path]]))
      return {
        files: kv.files ? kv.files.split('\n').filter(Boolean) : [],
        dirs: kv.dirs ? kv.dirs.split('\n').filter(Boolean) : [],
      }
    })
  }

  async fileStat (path: string): Promise<KvMap> {
    return this.mutex.runExclusive(() => this.fileStatImpl(path))
  }

  private async fileStatImpl (path: string): Promise<KvMap> {
    return this.requestKv(MsgType.FILE_STAT, encodeKv([['path', path]]))
  }

  async filePut (
    file: File,
    remotePath: string,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    return this.mutex.runExclusive(() => this.filePutImpl(file, remotePath, onProgress))
  }

  private async filePutImpl (
    file: File,
    remotePath: string,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const parent = parentDir(remotePath)
    if (parent) {
      await this.dirMkdirImpl(parent, true)
    }

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

  private async fileGetFrame (items: [string, string][]): Promise<Uint8Array> {
    const rid = this.transport.nextId()
    await this.transport.sendFrame(MsgType.FILE_GET, encodeKv(items), rid)
    const frame = await this.recvResponse(rid, MsgType.FILE_GET)
    return frame.payload
  }

  async fileGet (
    remotePath: string,
    onProgress?: (got: number, total: number) => void,
  ): Promise<Uint8Array> {
    return this.mutex.runExclusive(() => this.fileGetImpl(remotePath, onProgress))
  }

  private async fileGetImpl (
    remotePath: string,
    onProgress?: (got: number, total: number) => void,
  ): Promise<Uint8Array> {
    // 单帧 payload 上限 8MB(MAX_PAYLOAD);更大的文件用 offset/length 分段,
    // ≤8MB 保持单帧路径,兼容不认识 offset 参数的旧固件。
    const stat = await this.fileStatImpl(remotePath)
    const size = Number.parseInt(stat.size ?? '0', 10)
    if (!Number.isFinite(size) || size <= MAX_PAYLOAD) {
      const data = await this.fileGetFrame([['path', remotePath]])
      onProgress?.(data.length, data.length)
      return data
    }

    const out = new Uint8Array(size)
    let offset = 0
    while (offset < size) {
      const want = Math.min(DOWNLOAD_SEGMENT, size - offset)
      const piece = await this.fileGetFrame([
        ['path', remotePath],
        ['offset', String(offset)],
        ['length', String(want)],
      ])
      if (piece.length === 0) {
        break // 文件在拉取过程中被截短
      }
      out.set(piece, offset)
      offset += piece.length
      onProgress?.(offset, size)
    }
    if (offset !== size) {
      throw new Error(`分段下载不完整: 期望 ${size} 字节,实际 ${offset}(文件可能在传输中被修改)`)
    }
    return out
  }

  async fileDelete (path: string): Promise<void> {
    await this.mutex.runExclusive(() =>
      this.requestKv(MsgType.FILE_DELETE, encodeKv([['path', path]])),
    )
  }

  async fileRename (from: string, to: string): Promise<void> {
    await this.mutex.runExclusive(() =>
      this.requestKv(MsgType.FILE_RENAME, encodeKv([['from', from], ['to', to]])),
    )
  }

  async dirMkdir (path: string, parents = false): Promise<void> {
    await this.mutex.runExclusive(() => this.dirMkdirImpl(path, parents))
  }

  private async dirMkdirImpl (path: string, parents = false): Promise<void> {
    const items: [string, string][] = [['path', path]]
    if (parents) items.push(['parents', '1'])
    await this.requestKv(MsgType.FILE_MKDIR, encodeKv(items))
  }

  async commandExec (
    command: string,
    options?: { timeoutMs?: number; maxStdout?: number; maxStderr?: number },
  ): Promise<CommandResult> {
    return this.mutex.runExclusive(() => this.commandExecImpl(command, options))
  }

  private async commandExecImpl (
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
    const frame = await this.recvResponse(rid, MsgType.COMMAND_RESULT)
    return decodeCommandResult(frame.payload)
  }

  private async requestKv (type: MsgType, payload: Uint8Array): Promise<KvMap> {
    const rid = this.transport.nextId()
    await this.transport.sendFrame(type, payload, rid)
    return this.expectKv(rid)
  }

  private async expectKv (reqId: number): Promise<KvMap> {
    const frame = await this.recvResponse(reqId, MsgType.STATUS)
    return decodeKv(frame.payload)
  }

  /** 收本事务的响应帧。request_id 不符的帧是上个超时/失败事务的迟到应答,
   * 直接丢弃继续收(等价于 pyhost 的 drain),而不是当错误抛出去。 */
  private async recvResponse (reqId: number, expected: MsgType): Promise<Frame> {
    for (let drained = 0; drained < 8; drained++) {
      const frame = await this.transport.recvFrame()
      if (frame.requestId !== reqId) continue
      if (frame.type === MsgType.ERROR) {
        const kv = decodeKv(frame.payload)
        throw new Error(kv.message ?? 'unknown error')
      }
      if (frame.type !== expected) {
        throw new Error(`unexpected response type: ${frame.type}`)
      }
      return frame
    }
    throw new Error(`request_id mismatch: expected ${reqId}`)
  }
}

/** 把异步事务排成一条队列串行执行。前一个无论成功失败都不阻断后续。 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  runExclusive<T> (fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** 相对路径的父目录；无 `/` 时返回 null。 */
function parentDir (filePath: string): string | null {
  const i = filePath.lastIndexOf('/')
  if (i <= 0) {
    return null
  }
  return filePath.slice(0, i)
}

/**
 * web 端 USB 协议栈 fuzz(思路对齐 pyhost/fuzz_epass.py,目标换成宿主端):
 * 用包级仿真设备驱动真实的 UsbTransport + UsbResponderClient,注入故障后
 * 以「治愈设备 → hello 判活」为 oracle;action 挂起或 oracle 失败即 WEDGE。
 *
 * 类别:
 *   in_boundary  IN 方向应答长度边界扫描(短包/ZLP/整包边界)
 *   faults       确定性故障注入(延迟/断帧/垃圾/旧帧/超长 plen/reset 不可用…)
 *   random       种子随机组合
 *
 * 运行: node fuzz/run.mjs [--rounds N] [--seed S] [--only cat,cat]
 */
import { MsgType, encodeKv } from '@/protocol'
import { UsbTransport } from '@/usb/transport'
import { UsbResponderClient } from '@/usb/client'
import { MockDevice } from './mockDevice'
import type { Faults } from './mockDevice'

const TRANSPORT_TIMEOUT = 250
const OP_WATCHDOG = 3000
const ORACLE_WATCHDOG = 3000

const SCRATCH = '/tmp/fuzz'
const BLOB_PATH = `${SCRATCH}/blob.bin`
const BLOB_SIZE = 40_000
const blobData = new Uint8Array(BLOB_SIZE)
for (let i = 0; i < BLOB_SIZE; i++) blobData[i] = (i * 31 + 7) & 0xFF

interface Pair { dev: MockDevice, tp: UsbTransport, client: UsbResponderClient }

function makePair (faults: Faults = {}): Pair {
  const dev = new MockDevice()
  dev.faults = faults
  dev.dirs.add('/tmp')
  dev.dirs.add(SCRATCH)
  dev.files.set(BLOB_PATH, blobData.slice())
  const tp = new UsbTransport()
  const t = tp as any
  t.device = dev
  t.epIn = 1
  t.epOut = 2
  t.epOutPacketSize = 64
  if ('epInPacketSize' in t) t.epInPacketSize = 64
  t.timeout = TRANSPORT_TIMEOUT
  return { dev, tp, client: new UsbResponderClient(tp) }
}

type OutcomeState = 'ok' | 'error' | 'hang'
interface Outcome { state: OutcomeState, detail: string }

async function race (p: Promise<unknown>, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hang = new Promise<Outcome>(resolve => {
    timer = setTimeout(() => resolve({ state: 'hang', detail: `>${ms}ms 无响应` }), ms)
  })
  const wrapped: Promise<Outcome> = p.then(
    () => ({ state: 'ok' as const, detail: '' }),
    e => ({ state: 'error' as const, detail: e instanceof Error ? e.message : String(e) }),
  )
  const result = await Promise.race([wrapped, hang])
  clearTimeout(timer)
  return result
}

type Verdict = 'OK' | 'FAIL' | 'WEDGE'
interface CaseResult { cat: string, name: string, verdict: Verdict, detail: string }
const results: CaseResult[] = []

function record (cat: string, name: string, verdict: Verdict, detail: string): void {
  results.push({ cat, name, verdict, detail })
  const mark = { OK: '  ok    ', FAIL: ' FAIL   ', WEDGE: '!!WEDGE ' }[verdict]
  console.log(`[${cat}] ${name.padEnd(44)}${mark}${detail}`)
}

/**
 * 一个用例 = 全新连接 + 注入故障跑 action + 治愈 + hello oracle。
 * expectOpOk: action 本身必须成功(功能正确性用例);否则只要求不挂起、oracle 存活。
 */
async function runCase (
  cat: string,
  name: string,
  faults: Faults,
  action: (pair: Pair) => Promise<unknown>,
  opts: { expectOpOk?: boolean } = {},
): Promise<void> {
  const pair = makePair(faults)
  const op = await race(action(pair), OP_WATCHDOG)
  pair.dev.faults = {}
  const oracle = await race(pair.client.hello(), ORACLE_WATCHDOG)

  let verdict: Verdict = 'OK'
  const parts: string[] = []
  if (op.state !== 'ok') parts.push(`op ${op.state}: ${op.detail}`)
  if (oracle.state !== 'ok') parts.push(`oracle ${oracle.state}: ${oracle.detail}`)
  if (op.state === 'hang' || oracle.state !== 'ok') {
    verdict = 'WEDGE'
  } else if (opts.expectOpOk && op.state !== 'ok') {
    verdict = 'FAIL'
  }
  record(cat, name, verdict, parts.join(' | '))
}

// ---------------- in_boundary: IN 方向应答长度边界 ----------------

async function catInBoundary (): Promise<void> {
  const cat = 'in_boundary'
  // ranged FILE_GET: 应答 payload = length。覆盖 64 短包边界、16KiB URB 边界、
  // ZLP 边界(payload%64==40 时帧总长%64==0 → 设备补 ZLP)
  const lengths = [0, 1, 24, 40, 63, 64, 65, 104, 127, 128, 129, 192, 4096, 8192,
    16_360, 16_384, 16_408, 16_448, 32_768, 39_999, 40_000]
  for (const L of lengths) {
    await runCase(cat, `ranged_get_len=${L}`, {}, async ({ client }) => {
      const c = client as any
      const data: Uint8Array = await c.mutex.runExclusive(() =>
        c.fileGetFrame([['path', BLOB_PATH], ['offset', '0'], ['length', String(L)]]))
      const want = Math.min(L, BLOB_SIZE)
      if (data.length !== want) throw new Error(`长度不符: got ${data.length} want ${want}`)
      for (let i = 0; i < want; i++) {
        if (data[i] !== blobData[i]) throw new Error(`内容不符 @${i}`)
      }
    }, { expectOpOk: true })
  }

  // 整文件 fileGet(stat + 单帧路径)
  for (const size of [63, 64, 65, 4096, 8192, 16_384, 16_448, 40_000]) {
    await runCase(cat, `fileget_size=${size}`, {}, async ({ dev, client }) => {
      const path = `${SCRATCH}/f${size}.bin`
      dev.files.set(path, blobData.slice(0, size))
      const data = await client.fileGet(path)
      if (data.length !== size) throw new Error(`长度不符: got ${data.length}`)
    }, { expectOpOk: true })
  }

  // COMMAND_RESULT payload = 20 + stdout。n=44/108/16428 时 payload%64==0
  for (const n of [0, 1, 43, 44, 63, 64, 107, 108, 16_364, 16_428]) {
    await runCase(cat, `cmd_stdout=${n}`, {}, async ({ client }) => {
      const r = await client.commandExec(`gen ${n}`)
      if (r.stdout.length !== n) throw new Error(`stdout 长度不符: got ${r.stdout.length}`)
    }, { expectOpOk: true })
  }
}

// ---------------- out_boundary: 请求帧长度边界(宿主→设备) ----------------

/** 请求帧总长恰好是 mps 整数倍时,设备端 read() 收不到收尾短包 → 请求永远无应答。
 * 真机(F1C200s 全速, mps=64)上就是这么随机卡死的:素材目录一多,总有某条路径
 * 让 FILE_STAT 帧长凑成 64。这里按 1 字节步进扫过 64/128 两个边界。 */
async function catOutBoundary (): Promise<void> {
  const cat = 'out_boundary'

  // FILE_STAT 帧长 = 24(头) + 10(kv 头 + "path") + 路径长度
  const statFrameLen = (pathLen: number) => 34 + pathLen
  for (let pathLen = 26; pathLen <= 100; pathLen++) {
    const flen = statFrameLen(pathLen)
    if (flen % 64 !== 0 && flen % 64 !== 1 && flen % 64 !== 63) continue
    await runCase(cat, `stat_framelen=${flen}`, { zlpLost: true }, async ({ dev, client }) => {
      const prefix = `${SCRATCH}/`
      const path = prefix + 'a'.repeat(pathLen - prefix.length)
      dev.files.set(path, blobData.slice(0, 3))
      const stat = await client.fileStat(path)
      if (stat.size !== '3') throw new Error(`size 不符: ${stat.size}`)
    }, { expectOpOk: true })
  }

  // FILE_PUT_CHUNK 帧长 = 24 + 4 + 文件字节数;上传路径同样会撞边界
  for (const size of [35, 36, 37, 99, 100, 101, 16_355, 16_356, 16_357]) {
    await runCase(cat, `put_size=${size}`, { zlpLost: true }, async ({ dev, client }) => {
      const path = `${SCRATCH}/up${size}.bin`
      const file = new File([blobData.slice(0, size)], 'up.bin')
      await client.filePut(file, path)
      if (dev.files.get(path)?.length !== size) throw new Error('上传字节数不符')
    }, { expectOpOk: true })
  }
}

// ---------------- faults: 确定性故障注入 ----------------

function garbageWithHugePlen (): Uint8Array {
  // 32 字节垃圾,不含 MAGIC,偏移 16 处恰好是个巨大数——模拟失步后把垃圾当帧头
  const g = new Uint8Array(32).fill(0x5A)
  new DataView(g.buffer).setUint32(16, 0xFEEDFACE, true)
  return g
}

async function catFaults (): Promise<void> {
  const cat = 'faults'

  await runCase(cat, 'delay_beyond_timeout', { delayMs: 600 },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'delay_beyond_timeout_no_reset', { delayMs: 600, resetWorks: false },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'garbage_prefix_huge_plen', { garbagePrefix: garbageWithHugePlen() },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'garbage_prefix_small', { garbagePrefix: new Uint8Array([1, 2, 3, 4, 5, 6, 7]) },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'huge_plen_header', { hugePlen: 0xFFFF_FFF0 },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'huge_plen_header_8m1', { hugePlen: 8 * 1024 * 1024 + 1 },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'torn_response_30B', { tornBytes: 30 },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'torn_response_30B_no_reset', { tornBytes: 30, resetWorks: false },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'torn_header_10B', { tornBytes: 10 },
    ({ client }) => client.fileStat(BLOB_PATH))

  // 断帧前缀含真 MAGIC 且不足一个头:后续响应字节会补进 plen 字段,
  // 拼出"看似合法"的巨长帧头,单靠 resync 无法识别
  await runCase(cat, 'torn_header_14B_no_reset', { tornBytes: 14, resetWorks: false },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'torn_header_20B_no_reset', { tornBytes: 20, resetWorks: false },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'stale_frame_before_kv_reply', { staleFrameRid: 0xDEAD },
    ({ client }) => client.fileStat(BLOB_PATH), { expectOpOk: true })

  await runCase(cat, 'stale_frame_before_devinfo', { staleFrameRid: 0xDEAD },
    ({ client }) => client.devinfo(), { expectOpOk: true })

  await runCase(cat, 'stale_frame_before_fileget', { staleFrameRid: 0xDEAD },
    ({ client }) => client.fileGet(BLOB_PATH), { expectOpOk: true })

  await runCase(cat, 'stale_frame_before_cmd', { staleFrameRid: 0xDEAD },
    ({ client }) => client.commandExec('gen 5'), { expectOpOk: true })

  await runCase(cat, 'duplicate_response', { duplicateResponse: true },
    ({ client }) => client.fileStat(BLOB_PATH), { expectOpOk: true })

  await runCase(cat, 'error_response', { errorInstead: true },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'byte_dribble', { byteDribble: true },
    ({ client }) => client.fileStat(BLOB_PATH), { expectOpOk: true })

  await runCase(cat, 'drop_response', { dropResponses: true },
    ({ client }) => client.fileStat(BLOB_PATH))

  await runCase(cat, 'drop_response_no_reset', { dropResponses: true, resetWorks: false },
    ({ client }) => client.fileStat(BLOB_PATH))

  // 上传中途设备断开,随后换新连接(模拟拔线重连)
  await runCase(cat, 'disconnect_mid_put', {}, async ({ dev, client }) => {
    const file = new File([blobData.slice(0, 50_000)], 'x.bin')
    const p = client.filePut(file, `${SCRATCH}/x.bin`)
    setTimeout(() => { dev.faults = { disconnected: true } }, 30)
    try {
      await p
    } catch {
      /* 断开报错是预期 */
    }
    dev.faults = {}
  })

  // 并发风暴: mutex 串行化下 10 个混合操作 + 中途一次超时故障,队列必须能排空
  await runCase(cat, 'concurrent_storm_with_timeout', {}, async ({ dev, client }) => {
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 10; i++) {
      const p = i === 3
        ? client.fileStat('/nonexistent')
        : i === 5
          ? client.fileGet(BLOB_PATH)
          : client.fileStat(BLOB_PATH)
      ops.push(p.catch(() => {}))
    }
    setTimeout(() => { dev.faults = { delayMs: 600 } }, 10)
    setTimeout(() => { dev.faults = {} }, 700)
    await Promise.all(ops)
  })
}

// ---------------- random: 种子随机组合 ----------------

function makeRng (seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0
    return s / 0x1_0000_0000
  }
}

async function catRandom (rounds: number, seed: number): Promise<void> {
  const cat = 'random'
  const rng = makeRng(seed)
  const pick = <T, > (arr: T[]): T => arr[Math.floor(rng() * arr.length)]
  let pair = makePair()
  let wedges = 0

  for (let i = 0; i < rounds; i++) {
    const faults: Faults = {}
    const r = rng()
    if (r > 0.35) {
      const kinds = ['delay', 'garbage', 'stale', 'torn', 'dribble', 'error', 'drop', 'dup', 'hugePlen']
      const kind = pick(kinds)
      if (kind === 'delay') faults.delayMs = 600
      if (kind === 'garbage') {
        const n = 1 + Math.floor(rng() * 64)
        const g = new Uint8Array(n)
        for (let j = 0; j < n; j++) g[j] = Math.floor(rng() * 256)
        faults.garbagePrefix = g
      }
      if (kind === 'stale') faults.staleFrameRid = Math.floor(rng() * 0xFFFF)
      if (kind === 'torn') faults.tornBytes = Math.floor(rng() * 40)
      if (kind === 'dribble') faults.byteDribble = true
      if (kind === 'error') faults.errorInstead = true
      if (kind === 'drop') faults.dropResponses = true
      if (kind === 'dup') faults.duplicateResponse = true
      if (kind === 'hugePlen') faults.hugePlen = 0x8000_0000 + Math.floor(rng() * 0xFFFF)
      if (rng() < 0.3) faults.resetWorks = false
    }
    pair.dev.faults = faults

    const n = pick([1, 40, 44, 63, 64, 65, 128, 4096, 8192])
    const opName = pick(['hello', 'devinfo', 'list', 'stat', 'get', 'cmd', 'mkdir'])
    const { client } = pair
    const op =
      opName === 'hello' ? () => client.hello()
      : opName === 'devinfo' ? () => client.devinfo()
      : opName === 'list' ? () => client.fileList(SCRATCH)
      : opName === 'stat' ? () => client.fileStat(BLOB_PATH)
      : opName === 'get' ? () => {
        const c = client as any
        return c.mutex.runExclusive(() =>
          c.fileGetFrame([['path', BLOB_PATH], ['offset', '0'], ['length', String(n)]]))
      }
      : opName === 'cmd' ? () => client.commandExec(`gen ${n}`)
      : () => client.dirMkdir(`${SCRATCH}/d${i}`, true)

    const opOut = await race(op(), OP_WATCHDOG)
    pair.dev.faults = {}
    const oracle = await race(pair.client.hello(), ORACLE_WATCHDOG)
    if (opOut.state === 'hang' || oracle.state !== 'ok') {
      wedges++
      record(cat, `round${i}_${opName}_${JSON.stringify(faults)}`, 'WEDGE',
        `op ${opOut.state}: ${opOut.detail} | oracle ${oracle.state}: ${oracle.detail}`)
      pair = makePair() // 卡死后换新连接继续
    }
  }
  record(cat, `summary_${rounds}rounds_seed${seed}`, wedges === 0 ? 'OK' : 'WEDGE',
    `${rounds} 轮随机, 卡死 ${wedges} 次`)
}

// ---------------- main ----------------

async function main (): Promise<number> {
  const args = process.argv.slice(2)
  const getArg = (name: string, dflt: number): number => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? Number.parseInt(args[i + 1], 10) : dflt
  }
  const rounds = getArg('rounds', 80)
  const seed = getArg('seed', 20_260_718)
  const onlyIdx = args.indexOf('--only')
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null

  const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
    if (only && !only.has(name)) return
    console.log(`\n===== ${name} =====`)
    await fn()
  }

  await run('in_boundary', catInBoundary)
  await run('out_boundary', catOutBoundary)
  await run('faults', catFaults)
  await run('random', () => catRandom(rounds, seed))

  const wedges = results.filter(r => r.verdict === 'WEDGE').length
  const fails = results.filter(r => r.verdict === 'FAIL').length
  console.log(`\n总计 ${results.length} 用例, WEDGE ${wedges}, FAIL ${fails}`)
  return wedges + fails > 0 ? 1 : 0
}

main().then(code => process.exit(code), e => {
  console.error(e)
  process.exit(2)
})

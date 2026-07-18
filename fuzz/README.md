# web 端 USB 协议栈 fuzz

思路对齐 `usb_aio_handler/pyhost/fuzz_epass.py`,但测的是宿主端:用一个按
USB 包(≤64B)粒度仿真的设备(`mockDevice.ts`,行为对齐固件 responder.c /
protocol.c,包括 MAGIC resync、帧头单独写、ZLP 规则、URB FIFO 语义)驱动
真实的 `src/usb/transport.ts` + `client.ts`,注入故障后以「治愈设备 →
hello 判活」为 oracle,action 挂起或 oracle 失败即 WEDGE。

## 运行

```sh
node fuzz/run.mjs                      # 全部类别
node fuzz/run.mjs --only in_boundary   # 只跑边界扫描
node fuzz/run.mjs --only random --rounds 300 --seed 42
```

类别:
- `in_boundary` — IN 方向应答长度边界(64 短包 / 16KiB URB / ZLP 边界)
- `faults` — 确定性故障(延迟、断帧、垃圾、旧帧、超长 plen、reset 不可用、断开、并发风暴)
- `random` — 种子随机组合

## 曾经抓到的 bug(均已修复,回归时跑这里)

1. **短包边界卡死**:响应 payload%64==0 且 %16384!=0(下载 4KB/8KB 文件、
   stdout 恰 44 字节等)时,设备端没有短包也不补 ZLP(帧总长 %64!=0),
   宿主固定请求 16KiB 永远收不满 → 卡满超时。修复:按"还缺多少字节"向上
   取整到包大小请求(与 pyhost 读法一致)。
2. **坏帧头永久报废连接**:超长 plen/垃圾字节让 recvFrame 抛错但不消费缓冲,
   之后每个请求死于同一个残头。修复:对齐固件 read_frame_buffered,坏
   magic/version/plen/CRC 一律 resync 到下一个 MAGIC 续读。
3. **超时后状态残留**:reset 成功后 rxBuffer 残帧不清;reset 不可用时孤儿
   transferIn 偷吃后续响应。修复:reset 成功即清 rxLength;pendingRead
   单飞复用;recvFrame 失败时丢弃不可信的半截帧(等价固件 FRAME_STALE)。
4. **request_id 核对不一致**:devinfo/fileGet/commandExec 不核对 rid,迟到
   旧帧直接令操作误报。修复:统一 recvResponse,不符的帧按残留丢弃。

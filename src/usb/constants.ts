export const DEFAULT_VID = 0x1d6b
export const DEFAULT_PID = 0x0203
export const USB_REQUEST_CHUNK = 16 * 1024
export const MAX_PAYLOAD = 8 * 1024 * 1024
export const DEFAULT_FILE_CHUNK = USB_REQUEST_CHUNK - 4
// >MAX_PAYLOAD 的文件下载按此粒度分段(offset/length),单段必须 ≤ MAX_PAYLOAD
export const DOWNLOAD_SEGMENT = 4 * 1024 * 1024
// 设备端(io_utils.c bulk_in_needs_zlp)判定补 ZLP 的粒度:它拿不到协商速率,
// 一律按全速 64 / 高速 512 的公约数 64 判,所以宿主也必须按 64 判,不能用
// 实际协商出的 epInPacketSize
export const DEVICE_ZLP_UNIT = 64
// 死锁保险,不是常规超时:设备写 NAND 时脏页回写可让单次操作停顿几十秒
// (固件按 1MB 节奏 fsync),设太短会误杀慢传输
export const DEFAULT_TIMEOUT = 120_000

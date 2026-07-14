export const DEFAULT_VID = 0x1d6b
export const DEFAULT_PID = 0x0203
export const USB_REQUEST_CHUNK = 16 * 1024
export const MAX_PAYLOAD = 8 * 1024 * 1024
export const DEFAULT_FILE_CHUNK = USB_REQUEST_CHUNK - 4
// >MAX_PAYLOAD 的文件下载按此粒度分段(offset/length),单段必须 ≤ MAX_PAYLOAD
export const DOWNLOAD_SEGMENT = 4 * 1024 * 1024
// 死锁保险,不是常规超时:设备写 NAND 时脏页回写可让单次操作停顿几十秒
// (固件按 1MB 节奏 fsync),设太短会误杀慢传输
export const DEFAULT_TIMEOUT = 120_000

import type { UsbResponderClient } from '@/usb'
import { MATERIAL_STORAGES, type MaterialStorage } from '@/types/material'
import { formatBytes } from './format'

/** 设备端上传时为目标文件系统保留 5MiB 空闲(usb_aio_handler PROTOCOL.md §5.2),
 * 且途中按 ~1MiB 粒度复查,跌破即拒。预检留同等余量,避免传到一半才被设备拒绝。 */
export const STORAGE_RESERVE_BYTES = 5 * 1024 * 1024

/** 设备相对路径归属:sd/ 前缀是数据盘挂载点,其余落在系统盘 */
export function storageOfPath (path: string): MaterialStorage {
  return path === 'sd' || path.startsWith('sd/') ? 'sd' : 'nand'
}

export async function assertStorageCapacity (
  client: UsbResponderClient,
  storage: MaterialStorage,
  requiredBytes: number,
): Promise<void> {
  const devInfo = await client.devinfo()
  const label = MATERIAL_STORAGES[storage].displayLabel

  if (storage === 'sd' && devInfo.sd_mounted !== '1') {
    throw new Error('SD 卡未挂载，无法上传到数据盘')
  }

  const freeKey = storage === 'nand' ? 'nand_free_bytes' : 'sd_free_bytes'
  const freeBytes = Number.parseInt(devInfo[freeKey] ?? '0', 10)
  if (requiredBytes + STORAGE_RESERVE_BYTES > freeBytes) {
    throw new Error(
      `${label} 存储空间不足：需要 ${formatBytes(requiredBytes)}`
      + `（另含设备预留 ${formatBytes(STORAGE_RESERVE_BYTES)}），`
      + `剩余 ${formatBytes(freeBytes)}`,
    )
  }
}

import { ref, shallowRef } from 'vue'
import { UsbTransport, UsbResponderClient, DEFAULT_VID, DEFAULT_PID } from '@/usb'
import type { KvMap } from '@/protocol'
import { isWebUsbSupported } from '@/utils/browser'
import { useNotifications } from './useNotifications'

const connected = ref(false)
const client = shallowRef<UsbResponderClient | null>(null)
const transport = shallowRef<UsbTransport | null>(null)
const deviceInfo = ref<{ vendorId: number; productId: number; serialNumber: string } | null>(null)
const devInfo = ref<KvMap | null>(null)
const isSupported = ref(isWebUsbSupported())

export function useUsb () {
  const { notify } = useNotifications()

  async function connect (vid = DEFAULT_VID, pid = DEFAULT_PID) {
    try {
      const tp = new UsbTransport()
      tp.onDisconnect(() => {
        connected.value = false
        client.value = null
        deviceInfo.value = null
        devInfo.value = null
        notify('设备已断开', 'warning')
      })
      await tp.connect(vid, pid)
      transport.value = tp
      deviceInfo.value = tp.deviceInfo

      const cl = new UsbResponderClient(tp)
      await cl.hello()
      client.value = cl
      connected.value = true
      await refreshDevInfo()
      notify('已连接设备', 'success')
    } catch (e: any) {
      notify(`连接失败: ${e.message}`, 'error')
      throw e
    }
  }

  async function disconnect () {
    try {
      await transport.value?.disconnect()
    } finally {
      connected.value = false
      client.value = null
      deviceInfo.value = null
      devInfo.value = null
      transport.value = null
    }
  }

  async function refreshDevInfo () {
    if (!client.value) {
      devInfo.value = null
      return
    }
    try {
      devInfo.value = await client.value.devinfo()
    } catch {
      devInfo.value = null
    }
  }

  return {
    connected,
    client,
    deviceInfo,
    devInfo,
    isSupported,
    connect,
    disconnect,
    refreshDevInfo,
  }
}

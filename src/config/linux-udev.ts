import { DEFAULT_PID, DEFAULT_VID } from '@/usb/constants'
import { DFU_PRODUCT_ID, DFU_VENDOR_ID, FEL_PRODUCT_ID, FEL_VENDOR_ID } from '@/flash/constants'

function vidPidHex (id: number): string {
  return id.toString(16).padStart(4, '0')
}

/** udev 规则片段，供 Linux 用户复制到 /etc/udev/rules.d/ */
export const linuxUdevRulesText = [
  `ACTION=="add", SUBSYSTEM=="usb", ATTRS{idVendor}=="${vidPidHex(DEFAULT_VID)}", ATTRS{idProduct}=="${vidPidHex(DEFAULT_PID)}", MODE="0666", GROUP="users"`,
  `ACTION=="add", SUBSYSTEM=="usb", ATTRS{idVendor}=="${vidPidHex(FEL_VENDOR_ID)}", ATTRS{idProduct}=="${vidPidHex(FEL_PRODUCT_ID)}", MODE="0666", GROUP="users", TEST=="power/autosuspend", ATTR{power/autosuspend}="-1"`,
  `ACTION=="add", SUBSYSTEM=="usb", ATTRS{idVendor}=="${vidPidHex(DFU_VENDOR_ID)}", ATTRS{idProduct}=="${vidPidHex(DFU_PRODUCT_ID)}", MODE="0666", GROUP="users"`,
].join('\n\n')

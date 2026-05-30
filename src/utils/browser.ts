export function isWebUsbSupported (): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb
}

export function isLinux (): boolean {
  return typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
}

export function isWebUsbSupported (): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb
}

export function isAndroid (): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

export function isIOS (): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true
  }
  // iPadOS 13+ 可能伪装成 Mac
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function isWindows (): boolean {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
}

export function isLinux (): boolean {
  return typeof navigator !== 'undefined'
    && /linux/i.test(navigator.userAgent)
    && !isAndroid()
}

export type PlatformNoticeKind = 'linux' | 'windows' | 'android' | 'ios'

export function getPlatformNoticeKind (): PlatformNoticeKind | null {
  if (isIOS()) {
    return 'ios'
  }
  if (isAndroid()) {
    return 'android'
  }
  if (isWindows()) {
    return 'windows'
  }
  if (isLinux()) {
    return 'linux'
  }
  return null
}

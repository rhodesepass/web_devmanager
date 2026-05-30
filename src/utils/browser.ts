export function isWebUsbSupported (): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb
}

export function isAndroid (): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

export function isWindows (): boolean {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
}

export function isLinux (): boolean {
  return typeof navigator !== 'undefined'
    && /linux/i.test(navigator.userAgent)
    && !isAndroid()
}

export type PlatformNoticeKind = 'linux' | 'windows' | 'android'

export function getPlatformNoticeKind (): PlatformNoticeKind | null {
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

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

export function isInAppBrowser (): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent
  // 微信带 MicroMessenger;QQ 内置浏览器带 " QQ/8.x.x"(独立的 QQ浏览器是 MQQBrowser,不算)
  return /MicroMessenger/i.test(ua) || /\bQQ\/\d/.test(ua)
}

export function isWindows (): boolean {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
}

export function isLinux (): boolean {
  return typeof navigator !== 'undefined'
    && /linux/i.test(navigator.userAgent)
    && !isAndroid()
}

export type PlatformNoticeKind = 'linux' | 'windows' | 'android' | 'ios' | 'nowebusb' | 'inapp'

export function getPlatformNoticeKind (): PlatformNoticeKind | null {
  // 优先于平台判断,否则微信里的 Android 会先命中 android 提示
  if (isInAppBrowser()) {
    return 'inapp'
  }
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

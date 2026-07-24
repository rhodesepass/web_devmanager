import { siteLinks } from '@/config/site'

export interface AndroidManagerVersion {
  versionCode: number
  versionName: string
  apkUrl: string
  changelog: string
}

interface RawAndroidManagerVersion {
  versionCode?: unknown
  versionName?: unknown
  apkUrl?: unknown
  changelog?: unknown
}

/** 从 appversion.json 拉取最新 Android 管理器下载信息 */
export async function fetchAndroidManagerVersion (): Promise<AndroidManagerVersion> {
  const res = await fetch(siteLinks.androidManagerVersion, { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`获取 App 版本信息失败 (${res.status})`)
  }
  const raw = await res.json() as RawAndroidManagerVersion
  if (typeof raw.apkUrl !== 'string' || !raw.apkUrl) {
    throw new Error('App 版本信息缺少 apkUrl')
  }
  return {
    versionCode: typeof raw.versionCode === 'number' ? raw.versionCode : 0,
    versionName: typeof raw.versionName === 'string' ? raw.versionName : '',
    apkUrl: raw.apkUrl,
    changelog: typeof raw.changelog === 'string' ? raw.changelog : '',
  }
}

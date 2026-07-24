/** 主页外链与社群信息，可按需修改 */
export const siteLinks = {
  github: 'https://github.com/rhodesepass/',
  /** 通行证调试 / 项目文档 */
  debugDocs: 'https://epm.iccmc.cc/',
  qqGroup1: '1033668603',
  qqGroup2: '1072955003',
  qqQrImage1: '/qq-group-qr1.png',
  qqQrImage2: '/qq-group-qr2.png',
  /** 白银的文件存储 */
  oplst: 'https://oplst.iccmc.cc/',
  /** 固件清单基址（manifest.json 等） */
  flashBase: 'https://epflash.iccmc.cc/',
  /** 在线分享素材静态资源基址（manifest、previews 等） */
  sharedMaterialsBase: '/asset2share/',
  /** 应用商店静态资源基址（manifest、previews、apps 等） */
  sharedAppsBase: '/app2share/',
  /** USB 诊断工具 UsbTreeView（exe） */
  usbTreeView: 'https://oplst.iccmc.cc/%E8%BD%AF%E4%BB%B6_%E5%88%B7%E6%9C%BA%E5%8C%85/%EF%BC%88USB%E8%AF%8A%E6%96%AD%E5%B7%A5%E5%85%B7%EF%BC%89UsbTreeView.exe',
  /** Windows libusb 驱动安装包（zip，内含 drv_install.bat），本站 public/ 托管 */
  windowsDriver: '/epass_driver.zip',
  /** Android 管理器版本清单（含 apkUrl） */
  androidManagerVersion: 'https://epflash.iccmc.cc/appversion.json',
  /** 素材编辑器（Windows 安装包） */
  materialEditorSetup: 'https://openlist.slstudio.top/%E7%99%BD%E9%93%B6%E7%9A%84%E9%80%9A%E8%A1%8C%E8%AF%81/ArknightsPassMaker_v2.2.0_Setup.exe',
  /**
   * 通用离线刷机程序（zip：Windows 用 exe，其他平台可用 uv run main.py）
   * 适用于不支持 WebUSB 或在线刷机失败时的备选方案
   */
  offlineFlashTool: 'https://openlist.slstudio.top/%E7%99%BD%E9%93%B6%E7%9A%84%E9%80%9A%E8%A1%8C%E8%AF%81/%EF%BC%88Windows%E7%94%A8%E6%88%B7%E8%BF%90%E8%A1%8C%E9%87%8C%E9%9D%A2%E7%9A%84EXE%EF%BC%89%E5%88%B7%E6%9C%BA%E7%A8%8B%E5%BA%8FV3.zip',
} as const

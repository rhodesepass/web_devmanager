/** 复刻向导的静态内容:工具、下载文件、PCB 下单步骤、BOM 清单与外链 */

export interface ChecklistItem {
  id: string
  label: string
  /** 次要说明,灰字显示 */
  hint?: string
  link?: { text: string, url: string }
  /** 选做项,不计入该步完成度 */
  optional?: boolean
}

/** 屏幕型号:决定用哪个 FPC 座 */
export const REPRO_SCREENS = [
  { value: 'hsd', label: 'HSD / BOE' },
  { value: 'laowu', label: '3 元老五屏' },
] as const
export type ReproScreen = (typeof REPRO_SCREENS)[number]['value']

/** 三种屏的购买说明:HSD/BOE 硬件同用上接口 FPC2,区别在适配方式 */
export const REPRO_SCREEN_BUY = [
  { name: '3 元老五屏', hint: '很早期的屏,没有铁壳;用下接口 FPC1' },
  { name: 'HSD 屏', hint: '新屏,屏幕侧直接旋转显示;用上接口 FPC2' },
  { name: 'BOE 屏', hint: '新屏,靠主控端一些 hacks 适配;用上接口 FPC2' },
] as const

export interface BomAlt {
  value: string
  /** 厂商/选型说明,灰字显示 */
  note?: string
}

export interface BomEntry {
  reference: string
  value: string
  footprint: string
  quantity: number
  description: string
  /** 仅某种屏幕才需要的件(如 FPC 座),不填则始终显示 */
  screen?: ReproScreen
  /** 该件可不焊时的说明(如 SD 卡启动就不需要 NAND) */
  optionalNote?: string
  /** 展开按钮的文字,不填则按替代数量生成 "N 个 pin2pin 替代" */
  altLabel?: string
  /** 展开区顶部的整体说明 */
  altTitle?: string
  /** 替代型号/变体,展开显示 */
  alternatives?: BomAlt[]
}

export interface BomGroup {
  id: string
  name: string
  color: string
  items: BomEntry[]
}

/**
 * W25N01GVZEIG 的 pin2pin 替代型号。
 * 硬性条件(逐条核对过 ../buildroot 的 spi-nand 驱动 ID 表):
 *  - WSON-8、3.3V、128MB(page 2048B / 64 pages per block / 1024 blocks / 单 die);
 *  - U-Boot 2020.07 与 Linux 5.4.99 的 spi-nand 驱动**双边都支持**,缺一不可。
 * 已排除:1.8V 的东芝 CYG 系列、只有单边驱动的 GD5F1GQ4UF / Paragon PN26G01A、以及 2Gbit 以上大容量型号。
 */
export const NAND_ALTS: BomAlt[] = [
  { value: 'GD5F1GQ4UExxG', note: 'GigaDevice · 首选 · ECC 8bit' },
  { value: 'MX35LF1GE4AB', note: 'Macronix · 首选 · ECC 4bit' },
  { value: 'TC58CVG0S3', note: '东芝/铠侠 · 首选 · ECC 8bit' },
  { value: 'GD5F1GQ4UAxxG', note: 'GigaDevice · 可选' },
  { value: 'GD5F1GQ5UExxG', note: 'GigaDevice · 可选 · ECC 仅 4bit' },
  { value: 'HYF1GQ4UDACAE', note: '合肥恒烁 · 国产 · 可选' },
]

/** 主控 F1C200S 的新老丝印批次,以及引脚兼容但内存减半的 F1C100S */
export const F1C200S_VARIANTS: BomAlt[] = [
  { value: 'F1C200S(老版 BB)', note: '丝印左下角 7 位字母数字串以 BB 结尾,如 R6264BB · 推荐' },
  { value: 'F1C200S(新版 CB)', note: '丝印以 CB 结尾,如 R1117CB · 也可用' },
  { value: 'F1C100S', note: '引脚兼容,但内存只有 32MB,虽已大量优化仍不保证稳定运行,不推荐' },
]

export const reproLinks = {
  release: 'https://github.com/inapp123/epass_hardware/releases',
  bomOnline: 'https://docs.qq.com/sheet/DTUNVSW9USXBOS3VJ',
  hardwareRepo: 'https://github.com/inapp123/epass_hardware',
  lcedaPro: 'https://pro.lceda.cn/editor',
  lcedaHome: 'https://lceda.cn',
  jlcFreePcb: 'https://wiki.lceda.cn/zh-hans/design-production/free-pcb.html',
  pcbOrderGuide: 'https://hardware.slstudio.top/posts/fukexiangguan/pcbxiadan/',
  szlcsc: 'https://www.szlcsc.com',
  videoSolder: 'https://www.bilibili.com/video/BV1QaSBBUE43',
  videoSolderHard: 'https://www.bilibili.com/video/BV1xK5L6sEN4/',
  videoAssembly: 'https://b23.tv/Ystu8W8',
  videoFlash: 'https://www.bilibili.com/video/BV1Xu28BDEjL/',
  caseDrawings: 'https://oplst.iccmc.cc/%E5%A4%96%E5%A3%B3%E5%9B%BE%E7%BA%B8',
} as const

/** 工具准备:器材(来自 docs/guide/preparation.md 的工具表) */
export const REPRO_TOOLS: ChecklistItem[] = [
  { id: 'tool-iron', label: '电烙铁(如T12,可控温)', hint: '功率至少 30W,最便宜的可控温款即可' },
  { id: 'tool-tip', label: '烙铁头(刀头)', hint: '对自己好点,买个好使的' },
  { id: 'tool-paste', label: '锡浆/焊锡膏' ,hint: '建议选择针管装,方便控制用量'},
  { id: 'tool-wire', label: '焊锡丝' },
  { id: 'tool-flux', label: '助焊剂(焊油)' ,hint: '建议选择针管装,方便控制用量'},
  { id: 'tool-cleaner', label: '洗板水', hint: '焊完清洗助焊剂残留,配合毛刷用' },
  { id: 'tool-hotplate', label: '加热台', hint: '' },
  { id: 'tool-tweezers', label: '镊子', hint: '买三把的套件,自己看哪种合适' },
  { id: 'tool-uart', label: '串口调试工具(CH340)', hint: '用于查看启动日志/连接通行证Shell' },
  { id: 'tool-multimeter', label: '万用表', hint: '有电压档和导通挡即可,焊接测试步会用到' },
]

/** 工具准备:需下载的文件 */
export const REPRO_FILES: ChecklistItem[] = [
  {
    id: 'file-project',
    label: '硬件工程文件(嘉立创EDA 专业版工程 .epro2)',
    hint: '只有一个 .epro2 大工程,里面含 0603 / 0402 两个子工程,功能一样只是阻容封装不同,新手做 0603',
    link: { text: '前往 Release 下载', url: reproLinks.release },
  },
  {
    id: 'file-bom',
    label: '交互式 BOM(InteractiveBOM_V#.#_焊接辅助.html)',
    hint: '焊接时对照高亮位号,下一节也内嵌了一份可核对',
    link: { text: 'Release 下载', url: reproLinks.release },
  },
  {
    id: 'file-firmware',
    label: '固件',
    hint: '焊完烧录用,可在管理器「烧录」页直接联网获取',
    optional: true,
  },
]

/** PCB 下单:立创EDA 专业版一键下单流程 */
export const PCB_ORDER_STEPS: ChecklistItem[] = [
  {
    id: 'pcb-account',
    label: '注册立创账号,装好立创EDA 专业版',
    hint: '下单、领券、付款都用这个账号;客户端或在线版均可,同账号登录',
    link: { text: '打开在线版', url: reproLinks.lcedaPro },
  },
  {
    id: 'pcb-open',
    label: '用「文件 → 打开工程」打开这个 .epro2 大工程',
    hint: '.epro2 是嘉立创EDA 专业版原生工程,直接打开即可,无需转换;整份 Release 里只有这一个工程文件',
  },
  {
    id: 'pcb-version',
    label: '在工程树里选 0603 或 0402 子工程,双击其中的 PCB 打开',
    hint: '两个子工程同属一个大工程,功能一样只是阻容封装不同;手工焊强烈建议 0603,元件更大更好焊,0402 元件更小更难焊、板子尺寸一样并不省地方,适合有经验的',
  },
  {
    id: 'pcb-drc',
    label: '下单前跑「设计 → 检查 DRC」,把错误清零',
    hint: '重点看开路/短路、间距、丝印压焊盘;带错下单可能直接报废',
  },
  {
    id: 'pcb-order',
    label: '点「下单 → PCB下单」,软件自动生成制造文件并跳转嘉立创下单页',
    hint: '全程不需要手动导出 Gerber 再上传;未登录会提示登录',
  },
  {
    id: 'pcb-params',
    label: '核对工艺参数:数量(打样常选 5)、板厚 1.6mm、铜厚 1oz、绿色阻焊、有铅喷锡',
    hint: '这一组是标准免费/低价档,项目无特殊要求就保持默认',
  },
  {
    id: 'pcb-pay',
    label: '提交前领优惠券,审核通过后微信/支付宝付款',
    hint: '立创EDA 工程每月可免费领 2 张券,券种要和工艺匹配才免单',
    link: { text: '免费打样规则', url: reproLinks.jlcFreePcb },
  },
]

/** PCB 下单的关键注意事项(提示块,不勾选) */
export const PCB_ORDER_NOTES: string[] = [
  '免费打样门槛:板厚 0.8~1.6mm、外层铜厚 1oz、有铅喷锡或沉金、绿色阻焊(绿油是默认免费油墨)—— 超出算特殊工艺要加钱',
  '嘉立创EDA 设计每月可免费领 2 张券:喷锡券对应有铅喷锡,沉金券需先通过知识考试;券种要和工艺匹配才免单',
  '彩色丝印是付费项,且用了它阻焊只能选白色、还得配沉金工艺,不能和绿油随意组合',
  '想走免费打样,在板子的铺铜区域加几个过孔、再修改部分丝印,然后按下方「免费打样规则」链接的教程领取优惠券;过孔加在铺铜上就行,别落到走线上导致短路',
  '磨边、钢网、付费加急也都要额外收费(绿油板享 48 小时免费加急)',
  'DRC 必须清零:开路/短路、间距不足、丝印压焊盘、开窗错误是最常见的报废原因',
  '首板建议单块不拼、不加急,先花小钱验证板子没问题再考虑量产',
]

/** 结构件下单:图纸下载与总勾选,配件明细见 REPRO_CASE_BOM */
export const REPRO_CASE: ChecklistItem[] = [
  {
    id: 'case-drawings',
    label: '下载外壳图纸与文件包(外壳 / 面板 / 保护板)',
    hint: '亚克力面板、底部保护板的切割文件都在这个包里',
    link: { text: '前往下载', url: reproLinks.caseDrawings },
  },
  { id: 'case-ordered', label: '已下单外壳、面板与配套螺丝螺柱' },
]

/** 外壳下单前必读(厚度选择与加工方式) */
export const REPRO_CASE_NOTES: string[] = [
  '外壳厚度二选一(见图纸文件名):8mm 稍难装,建议有机械装配经验、动手能力较好的老师选,加工有优惠;8.2mm 装配适中,加工正常付费',
  '外壳本体:找厂 CNC 加工,或用图纸包里的 3D 打印文件自行打印,选对应文件即可',
  '底部亚克力保护板可选,1mm 即可,文件在图纸包里(底部亚克力保护板V2.1发商家代切),约 2 元/片,用沉头螺丝固定',
]

export interface CaseBomEntry {
  part: string
  spec?: string
  note?: string
  link?: string
  /** 多个可选购买入口(如同一零件的内六角/十字两款) */
  links?: { text: string, url: string }[]
  optional?: boolean
}

/** 外壳配件 BOM(整理自「CNC外壳bom」表;购买链接已去掉淘宝/天猫追踪参数,只留 id 与 skuId) */
export const REPRO_CASE_BOM: CaseBomEntry[] = [
  { part: '外壳本体', spec: 'CNC 8mm / 8.2mm', note: 'CNC 找厂加工,或用图纸包里的 3D 打印文件打印(选对应文件)' },
  { part: '亚克力丝印面板', spec: '46*78mm · 0.5mm', note: '嘉立创柔性板站下单,选:透明亚克力 · 底面 · 0.5mm · 正品 3M468(全透明防水);想更遮光就加一层黑底', link: 'https://www.szlcmb.com/' },
  { part: '底部亚克力保护板', spec: '1mm', note: '文件在图纸包里,约 2 元/片,别买贵了。也可在嘉立创柔性板站下单:选纯切割不打印 · 50*100 · 不要背胶', links: [{ text: '淘宝代切', url: 'https://item.taobao.com/item.htm?id=740751033605&skuId=5111560077159' }, { text: '嘉立创切割', url: 'https://www.szlcmb.com/' }], optional: true },
  { part: '贴片螺柱', spec: 'M2*C4*3+C2.5*1', note: 'v1.9 及以上版本', link: 'https://item.taobao.com/item.htm?id=655855111684' },
  { part: '顶部外壳固定螺丝', spec: '矮头 M2*6', note: '重点是矮头;内六角或十字按手头螺丝刀二选一', links: [{ text: '内六角', url: 'https://detail.tmall.com/item.htm?id=601483233737&skuId=5070539921266' }, { text: '十字', url: 'https://detail.tmall.com/item.htm?id=601686286684&skuId=5842202534211' }] },
  { part: '底部保护板固定螺丝', spec: '沉头 M2*3(2.5mm 保护板改 M2*4)', note: '重点是沉头;内六角或十字二选一', links: [{ text: '内六角', url: 'https://detail.tmall.com/item.htm?id=601243536477&skuId=5665127772955' }, { text: '十字', url: 'https://detail.tmall.com/item.htm?id=601483069990&skuId=4325230717706' }], optional: true },
]

/**
 * 元件 BOM 清单(提取自 hardware/InteractiveBOM_V0.6_*_焊接辅助.html 的嘉立创EDA 设计数据)。
 * 0603 / 0402 两版功能一致,仅阻容封装不同;分类按器件功能归并。
 */
export const REPRO_BOM_0603: BomGroup[] = [
  {
    id: 'core', name: '主控与核心', color: '#2196F3',
    items: [
      { reference: 'U4', value: 'F1C200S', footprint: 'QFN-88-EP(10x10)', quantity: 1, description: '主控 SoC(市售翻新多,建议多买几片备用)', altLabel: '版本与选型', altTitle: 'F1C200S 分新老丝印批次,推荐老版 BB;F1C100S 引脚兼容但内存减半,不推荐:', alternatives: F1C200S_VARIANTS },
      { reference: 'U6', value: 'W25N01GVZEIG', footprint: 'WSON-8-EP(6.1x8)', quantity: 1, description: '128MB SPI NAND(系统盘)', optionalNote: 'SD 卡启动则不需要,可不焊', altTitle: '以下型号均为 WSON-8 / 3.3V / 128MB,U-Boot + Linux 的 MTD 驱动都已支持,pin2pin 可换:', alternatives: NAND_ALTS },
      { reference: 'X1', value: '24MHz', footprint: 'SMD3225-4P', quantity: 1, description: '主晶振' },
    ],
  },
  {
    id: 'power', name: '电源', color: '#4CAF50',
    items: [
      { reference: 'U1', value: 'GEK100-33', footprint: 'SOT-23-6', quantity: 1, description: '单键开关机 IC(长按/双击/软复位);型号尾缀 XX = 按住 X 秒开机 + X 秒关机,推荐 33' },
      { reference: 'D1,D2,D3', value: '1N5819WS', footprint: 'SOD-323', quantity: 3, description: '肖特基二极管' },
      { reference: 'Q1,Q2', value: 'AO3401A', footprint: 'SOT-23', quantity: 2, description: 'P-MOS 开关' },
      { reference: 'U2', value: 'TP4056', footprint: 'ESOP-8', quantity: 1, description: '锂电充电管理' },
      { reference: 'U3', value: 'EA3036CQBR', footprint: 'WQFN-20-EP(3x3)', quantity: 1, description: '多路 PMIC 电源' },
      { reference: 'U7', value: 'PW1515', footprint: 'SOT-23-5', quantity: 1, description: '电源开关/限流' },
    ],
  },
  {
    id: 'display', name: '屏幕与背光', color: '#F44336',
    items: [
      { reference: 'FPC1', value: '0.5mm 40P 卧贴 FPC(下接)', footprint: 'SMD,P=0.5mm,卧贴', quantity: 1, description: '老五屏用,如 AFC01-S40FCA-00', screen: 'laowu' },
      { reference: 'FPC2', value: '0.5mm 40P 卧贴 FPC(上接)', footprint: 'SMD,P=0.5mm,卧贴', quantity: 1, description: 'HSD / BOE 屏用,如 AFC07-S40ECA-00', screen: 'hsd' },
      { reference: 'LED1', value: '红', footprint: '0805', quantity: 1, description: '指示灯' },
      { reference: 'LED2', value: '绿', footprint: '0805', quantity: 1, description: '指示灯' },
      { reference: 'LED3', value: '蓝', footprint: '0805', quantity: 1, description: '指示灯' },
      { reference: 'U5', value: 'STI9287C', footprint: 'SOT-23-6', quantity: 1, description: '背光升压驱动', altLabel: '备选型号', altTitle: '社区实测可用的背光驱动备选:', alternatives: [{ value: 'SY7200' }, { value: 'MSAP3032KTR-G1', note: '立创 C49208388' }] },
    ],
  },
  {
    id: 'connector', name: '接口与连接器', color: '#FF9800',
    items: [
      { reference: 'CARD1', value: 'TF-115-BCP9', footprint: 'SMD', quantity: 1, description: 'TF 卡座' },
      { reference: 'D4', value: 'RCLAMP0522P', footprint: 'DFN1610-6L', quantity: 1, description: 'USB ESD 保护' },
      { reference: 'J1,J2', value: '2.54mm 2x5P 卧贴排母', footprint: 'SMD,P=2.54mm,卧贴', quantity: 2, description: '扩展口。如 HX PM2.54-2x5P WT' },
      { reference: 'J3', value: '1.0WT-2P', footprint: 'SH1.0', quantity: 1, description: '电池座 SH1.0' },
      { reference: 'USB1', value: 'TYPE-C 16PIN 2MD(073)', footprint: 'SMD', quantity: 1, description: 'USB-C 母座' },
    ],
  },
  {
    id: 'button', name: '按键', color: '#00BCD4',
    items: [
      { reference: 'SW1,SW2,SW3,SW4,SW5,SW6', value: 'TS24CA', footprint: 'SMD,4.6x1.8mm', quantity: 6, description: '侧按键' },
    ],
  },
  {
    id: 'passive', name: '无源阻容感', color: '#9C27B0',
    items: [
      { reference: 'C1,C2,C4,C6,C7,C8,C10,C12,C39', value: '10uF', footprint: '0603', quantity: 9, description: '电容' },
      { reference: 'C3,C9,C11', value: '220pF', footprint: '0402', quantity: 3, description: '电容' },
      { reference: 'C5,C13,C14,C17,C19,C20,C21,C23,C24,C25,C26,C40,C46,C48,C49', value: '1uF', footprint: '0603', quantity: 15, description: '电容' },
      { reference: 'C15,C16,C18,C22,C29,C30,C31,C32,C33,C34,C35,C36,C37,C38,C41,C42,C43,C44,C45', value: '100nF', footprint: '0603', quantity: 19, description: '电容' },
      { reference: 'C27,C28', value: '22pF', footprint: '0603', quantity: 2, description: '电容' },
      { reference: 'C47', value: '220pF', footprint: '0603', quantity: 1, description: '电容' },
      { reference: 'L1,L2,L3,L4', value: '1.5uH', footprint: '1008', quantity: 4, description: '电感' },
      { reference: 'R1', value: '0Ω', footprint: '0603', quantity: 1, description: '电阻' },
      { reference: 'R2,R3,R13,R23,R24', value: '5.1kΩ', footprint: '0603', quantity: 5, description: '电阻' },
      { reference: 'R4', value: '560Ω', footprint: '0603', quantity: 1, description: '电阻' },
      { reference: 'R5,R9,R14,R15,R16,R19,R34,R36,R38', value: '68kΩ', footprint: '0603', quantity: 9, description: '电阻' },
      { reference: 'R6,R8,R25,R26', value: '2kΩ', footprint: '0603', quantity: 4, description: '电阻' },
      { reference: 'R7', value: '200mΩ', footprint: '0805', quantity: 1, description: '电阻' },
      { reference: 'R10', value: '15kΩ', footprint: '0603', quantity: 1, description: '电阻' },
      { reference: 'R11,R12,R17,R18,R20,R27,R29,R30,R31,R32,R33,R35,R37,R39,R40,R41,R42,R43,R44,R45', value: '10kΩ', footprint: '0603', quantity: 20, description: '电阻' },
      { reference: 'R21,R22', value: '200kΩ', footprint: '0603', quantity: 2, description: '电阻' },
      { reference: 'R28', value: '10Ω', footprint: '0603', quantity: 1, description: '电阻' },
    ],
  },
]

export const REPRO_BOM_0402: BomGroup[] = [
  {
    id: 'core', name: '主控与核心', color: '#2196F3',
    items: [
      { reference: 'U4', value: 'F1C200S', footprint: 'QFN-88-EP(10x10)', quantity: 1, description: '主控 SoC(市售翻新多,建议多买几片备用)', altLabel: '版本与选型', altTitle: 'F1C200S 分新老丝印批次,推荐老版 BB;F1C100S 引脚兼容但内存减半,不推荐:', alternatives: F1C200S_VARIANTS },
      { reference: 'U6', value: 'W25N01GVZEIG', footprint: 'WSON-8-EP(6.1x8)', quantity: 1, description: '128MB SPI NAND(系统盘)', optionalNote: 'SD 卡启动则不需要,可不焊', altTitle: '以下型号均为 WSON-8 / 3.3V / 128MB,U-Boot + Linux 的 MTD 驱动都已支持,pin2pin 可换:', alternatives: NAND_ALTS },
      { reference: 'X1', value: '24MHz', footprint: 'SMD3225-4P', quantity: 1, description: '主晶振' },
    ],
  },
  {
    id: 'power', name: '电源', color: '#4CAF50',
    items: [
      { reference: 'U1', value: 'GEK100-33', footprint: 'SOT-23-6', quantity: 1, description: '单键开关机 IC(长按/双击/软复位);型号尾缀 XX = 按住 X 秒开机 + X 秒关机,推荐 33' },
      { reference: 'D1,D2,D3', value: '1N5819WS', footprint: 'SOD-323', quantity: 3, description: '肖特基二极管' },
      { reference: 'Q1,Q2', value: 'AO3401A', footprint: 'SOT-23', quantity: 2, description: 'P-MOS 开关' },
      { reference: 'U2', value: 'TP4056', footprint: 'ESOP-8', quantity: 1, description: '锂电充电管理' },
      { reference: 'U3', value: 'EA3036CQBR', footprint: 'WQFN-20-EP(3x3)', quantity: 1, description: '多路 PMIC 电源' },
      { reference: 'U7', value: 'PW1515', footprint: 'SOT-23-5', quantity: 1, description: '电源开关/限流' },
    ],
  },
  {
    id: 'display', name: '屏幕与背光', color: '#F44336',
    items: [
      { reference: 'FPC1', value: '0.5mm 40P 卧贴 FPC(下接)', footprint: 'SMD,P=0.5mm,卧贴', quantity: 1, description: '老五屏用,如 AFC01-S40FCA-00', screen: 'laowu' },
      { reference: 'FPC2', value: '0.5mm 40P 卧贴 FPC(上接)', footprint: 'SMD,P=0.5mm,卧贴', quantity: 1, description: 'HSD / BOE 屏用,如 AFC07-S40ECA-00', screen: 'hsd' },
      { reference: 'LED1', value: '红', footprint: '0805', quantity: 1, description: '指示灯' },
      { reference: 'LED2', value: '绿', footprint: '0805', quantity: 1, description: '指示灯' },
      { reference: 'LED3', value: '蓝', footprint: '0805', quantity: 1, description: '指示灯' },
      { reference: 'U5', value: 'STI9287C', footprint: 'SOT-23-6', quantity: 1, description: '背光升压驱动', altLabel: '备选型号', altTitle: '社区实测可用的背光驱动备选:', alternatives: [{ value: 'SY7200' }, { value: 'MSAP3032KTR-G1', note: '立创 C49208388' }] },
    ],
  },
  {
    id: 'connector', name: '接口与连接器', color: '#FF9800',
    items: [
      { reference: 'CARD1', value: 'TF-115-BCP9', footprint: 'SMD', quantity: 1, description: 'TF 卡座' },
      { reference: 'D4', value: 'RCLAMP0522P', footprint: 'DFN1610-6L', quantity: 1, description: 'USB ESD 保护' },
      { reference: 'J1,J2', value: '2.54mm 2x5P 卧贴排母', footprint: 'SMD,P=2.54mm,卧贴', quantity: 2, description: '扩展口。如 HX PM2.54-2x5P WT' },
      { reference: 'J3', value: '1.0WT-2P', footprint: 'SH1.0', quantity: 1, description: '电池座 SH1.0' },
      { reference: 'USB1', value: 'TYPE-C 16PIN 2MD(073)', footprint: 'SMD', quantity: 1, description: 'USB-C 母座' },
    ],
  },
  {
    id: 'button', name: '按键', color: '#00BCD4',
    items: [
      { reference: 'SW1,SW2,SW3,SW4,SW5,SW6', value: 'TS24CA', footprint: 'SMD,4.6x1.8mm', quantity: 6, description: '侧按键' },
    ],
  },
  {
    id: 'passive', name: '无源阻容感', color: '#9C27B0',
    items: [
      { reference: 'C1,C2,C4,C6,C7,C8,C10,C12,C39', value: '10uF', footprint: '0402', quantity: 9, description: '电容' },
      { reference: 'C3,C9,C11', value: '220pF', footprint: '0402', quantity: 3, description: '电容' },
      { reference: 'C5,C13,C14,C17,C19,C20,C21,C23,C24,C25,C26,C40,C46,C48,C49', value: '1uF', footprint: '0402', quantity: 15, description: '电容' },
      { reference: 'C15,C16,C18,C22,C29,C30,C31,C32,C33,C34,C35,C36,C37,C38,C41,C42,C43,C44,C45', value: '100nF', footprint: '0402', quantity: 19, description: '电容' },
      { reference: 'C27,C28', value: '22pF', footprint: '0603', quantity: 2, description: '电容' },
      { reference: 'C47', value: '220pF', footprint: '0402', quantity: 1, description: '电容' },
      { reference: 'L1,L2,L3,L4', value: '1.5uH', footprint: '1008', quantity: 4, description: '电感' },
      { reference: 'R1', value: '0Ω', footprint: '0402', quantity: 1, description: '电阻' },
      { reference: 'R2,R3,R13,R23,R24', value: '5.1kΩ', footprint: '0402', quantity: 5, description: '电阻' },
      { reference: 'R4', value: '560Ω', footprint: '0402', quantity: 1, description: '电阻' },
      { reference: 'R5,R9,R14,R15,R16,R19,R34,R36,R38', value: '68kΩ', footprint: '0402', quantity: 9, description: '电阻' },
      { reference: 'R6,R8,R25,R26', value: '2kΩ', footprint: '0402', quantity: 4, description: '电阻' },
      { reference: 'R7', value: '200mΩ', footprint: '0805', quantity: 1, description: '电阻' },
      { reference: 'R10', value: '15kΩ', footprint: '0402', quantity: 1, description: '电阻' },
      { reference: 'R11,R12,R17,R18,R20,R27,R29,R30,R31,R32,R33,R35,R37,R39,R40,R41,R42,R43,R44,R45', value: '10kΩ', footprint: '0402', quantity: 20, description: '电阻' },
      { reference: 'R21,R22', value: '200kΩ', footprint: '0402', quantity: 2, description: '电阻' },
      { reference: 'R28', value: '10Ω', footprint: '0402', quantity: 1, description: '电阻' },
    ],
  },
]

export const REPRO_BOM_VERSIONS = ['0603', '0402'] as const
export type ReproBomVersion = (typeof REPRO_BOM_VERSIONS)[number]

export function reproBom (version: ReproBomVersion): BomGroup[] {
  return version === '0402' ? REPRO_BOM_0402 : REPRO_BOM_0603
}

/** 焊接/贴装前的提示,配视频链接 */
export const ASSEMBLY_NOTES: string[] = [
  '本项目含 QFN 表面贴装器件,没有 0603 以上贴片焊接经验的话,建议先拿简单项目练手',
  '上电前务必检查电路:有无连锡、错焊、漏焊',
  '主控 F1C200S、NAND、晶振这些关键件焊完,建议先用下一步的系统测试排一遍虚焊再继续',
]

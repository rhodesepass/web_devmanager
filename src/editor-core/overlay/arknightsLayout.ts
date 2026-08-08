/**
 * arknights overlay 固件排版常量（360x640 逻辑基准，720 档整层 ×2）。
 * 真源：drm_app_neo/src/overlay/opinfo.c（overlay_opinfo_show_arknights）与
 * devmanager MaterialEditorScreen.kt 的 ArknightsOverlayPreview。
 * 仅供预览层复刻；设备端自行渲染，这些值不进 epconfig。
 */

export const OVERLAY_W = 360
export const OVERLAY_H = 640

/** top_left_rect 模板图 x 偏移 */
export const RECT_OFFSET_X = 60
/** 左下信息区（干员名/代号/staff/aux/职业图标/ak_bar）的 x */
export const BTM_INFO_X = 70

export const OPNAME_Y = 415
export const OPNAME_FONT_SIZE = 40

export const UPPER_LINE_Y = 455
export const LOWER_LINE_Y = 475
export const LINE_WIDTH = 280

export const OPCODE_Y = 457
export const STAFF_TEXT_Y = 480
export const BODY_FONT_SIZE = 14

export const CLASS_ICON_Y = 525
export const CLASS_ICON_SIDE = 50

export const AK_BAR_Y = 578

export const AUX_TEXT_Y = 592
export const AUX_TEXT_LINE_H = 15
export const AUX_TEXT_MAX_LINES = 3

export const BARCODE_X = 1
export const BARCODE_Y = 450
export const BARCODE_W = 50
export const BARCODE_H = 180

export const TOP_RIGHT_ARROW_Y = 100

/** top_left_rhodes 文字（非空时替代罗德岛 logo 图）：rot90，Bebas Bold 72 */
export const RHODES_TEXT_X = 0
export const RHODES_TEXT_Y = 5
export const RHODES_FONT_SIZE = 72

/** top_right_bar_text 覆盖区域（相对 top_right_bar 图左上角） */
export const TOP_RIGHT_BAR_TEXT_X = 42
export const TOP_RIGHT_BAR_TEXT_Y = 314
export const TOP_RIGHT_BAR_TEXT_BOTTOM = 416
export const TOP_RIGHT_BAR_FONT_SIZE = 10

/** 右下主题色径向渐变终态半径 */
export const COLOR_FADE_RADIUS = 192

/** logo 右下内边距 */
export const LOGO_PADDING = 10

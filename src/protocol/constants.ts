export const MAGIC = 0x45504153 // "EPAS" in little-endian
export const VERSION = 1
export const HEADER_SIZE = 24
export const MAX_PAYLOAD = 8 * 1024 * 1024

export enum MsgType {
  HELLO = 1,
  STATUS = 2,
  ERROR = 3,

  FILE_PUT_BEGIN = 10,
  FILE_PUT_CHUNK = 11,
  FILE_PUT_END = 12,
  FILE_GET = 13,
  FILE_LIST = 14,
  FILE_DELETE = 15,
  FILE_RENAME = 16,
  FILE_MKDIR = 17,
  FILE_STAT = 18,

  COMMAND_EXEC = 20,
  COMMAND_RESULT = 21,

  DEVINFO = 30,
}

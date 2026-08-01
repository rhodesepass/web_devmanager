import type { OpenedUsb, TestPin } from '@/flash'
import { computed, ref } from 'vue'
import {
  closeUsb,
  connectFelInteractive,
  F1C_CHIP_ID,
  FelClient,
  formatJedecId,
  getLradcKeys,
  getTestPins,
  GpioTester,
  lradcDisable,
  lradcEnable,
  lradcMatchKey,
  lradcRawToUv,
  lradcReadRaw,
  probeSpiNand,
  recoverFelClient,
  runDdrTest,
} from '@/flash'
import { isWebUsbSupported } from '@/utils/browser'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'

const HALF_PERIOD_MS = 2000 // 0.25Hz:高低电平各持续 2 秒

export type StageStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail'

export interface TestStage {
  key: 'chip' | 'nand' | 'ddr'
  title: string
  status: StageStatus
  detail: string
}

function makeStages (): TestStage[] {
  return [
    { key: 'chip', title: '芯片识别', status: 'pending', detail: '' },
    { key: 'nand', title: 'SPI NAND 检测', status: 'pending', detail: '' },
    { key: 'ddr', title: 'DDR 初始化与容量', status: 'pending', detail: '' },
  ]
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function useSystemTest () {
  const { notify } = useNotifications()
  const transferLock = useTransferLock()

  const isSupported = ref(isWebUsbSupported())
  const connected = ref(false)
  const connecting = ref(false)
  const error = ref<string | null>(null)
  const logs = ref<string[]>([])

  const selectedRev = ref('0.6')
  const pins = computed(() => getTestPins(selectedRev.value))

  const stages = ref<TestStage[]>(makeStages())
  const autoRunning = ref(false)
  const summary = ref<string | null>(null)

  const activePin = ref<TestPin | null>(null)
  const expected = ref<0 | 1>(0)
  const toggleCount = ref(0)

  // 0.5/0.6 的 gpio-poweroff:PE2 拉高即切断电源(设备树 gpio-poweroff 节点)
  const POWEROFF_PIN: TestPin = { key: 'poweroff', signal: 'PWR_OFF', pinName: 'PE2', bank: 4, pin: 2 }
  const POWEROFF_TIMEOUT_MS = 8000
  const supportsPoweroff = computed(() => ['0.5', '0.6'].includes(selectedRev.value))
  const poweroffPending = ref(false)

  const lradcActive = ref(false)
  const lradcRaw = ref<number | null>(null)
  const lradcVoltageUv = ref<number | null>(null)
  const lradcKeyLabel = ref<string | null>(null)
  const lradcKeys = computed(() => getLradcKeys(selectedRev.value))
  let lradcLoopPromise: Promise<void> | null = null

  let opened: OpenedUsb | null = null
  let fel: FelClient | null = null
  let tester: GpioTester | null = null
  let running = false
  let loopPromise: Promise<void> | null = null

  function appendLog (line: string) {
    logs.value = [...logs.value, line]
  }

  function setStage (key: TestStage['key'], status: StageStatus, detail: string) {
    stages.value = stages.value.map(s => s.key === key ? { ...s, status, detail } : s)
  }

  /** FEL 传输出错后复位设备并重建依赖它的 client（不弹窗） */
  async function reconnectFel (): Promise<void> {
    const recovered = await recoverFelClient(opened)
    opened = recovered.opened
    fel = recovered.fel
    tester = new GpioTester(fel)
  }

  async function connect () {
    if (connected.value || connecting.value) {
      return
    }
    connecting.value = true
    error.value = null
    logs.value = []
    stages.value = makeStages()
    summary.value = null
    try {
      opened = await connectFelInteractive()
      fel = new FelClient(opened)
      const version = await fel.version()
      appendLog(`已连接 FEL,芯片 id = 0x${version.id.toString(16)}`)
      tester = new GpioTester(fel)
      connected.value = true
      transferLock.begin('系统测试', null, { overlay: false })
      navigator.usb.addEventListener('disconnect', onUsbDisconnect)
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      error.value = msg
      appendLog(`连接失败:${msg}`)
      notify(msg, 'error')
      if (opened) {
        await closeUsb(opened)
        opened = null
      }
      fel = null
    } finally {
      connecting.value = false
    }
  }

  async function runAutoTest () {
    if (!connected.value || !fel || autoRunning.value) {
      return
    }
    await stopWave()
    await stopLradcTest()
    autoRunning.value = true
    stages.value = makeStages()
    summary.value = null
    const parts: string[] = []
    try {
      // 1. 芯片识别
      setStage('chip', 'running', '读取 FEL 版本信息…')
      try {
        const version = await fel.version()
        const idHex = `0x${version.id.toString(16).padStart(8, '0')}`
        if (version.id === F1C_CHIP_ID) {
          setStage('chip', 'pass', `F1C100S/F1C200S 家族(id=${idHex})`)
          appendLog(`芯片识别通过,id=${idHex}`)
        } else {
          setStage('chip', 'fail', `芯片 id=${idHex},不是 F1C 系列,终止测试`)
          appendLog(`芯片识别失败,id=${idHex}`)
          return
        }
      } catch (error_: unknown) {
        const msg = error_ instanceof Error ? error_.message : String(error_)
        setStage('chip', 'fail', `读取失败:${msg}`)
        return
      }

      // 2. SPI NAND
      setStage('nand', 'running', '读取 JEDEC ID…')
      try {
        const nand = await probeSpiNand(fel)
        const idHex = formatJedecId(nand.raw)
        switch (nand.status) {
          case 'match': {
            const capMb = nand.entry!.capacity / (1024 * 1024)
            setStage('nand', 'pass', `${nand.entry!.name},${capMb}MB(id: ${idHex})`)
            appendLog(`NAND 识别为 ${nand.entry!.name}`)
            parts.push(`NAND ${nand.entry!.name} ${capMb}MB`)
            break
          }
          case 'absent': {
            setStage('nand', 'fail', `ID 读回 ${idHex},NAND 不存在:未焊上、虚焊或已损坏`)
            appendLog('NAND 检测失败:ID 全 0 或全 FF')
            break
          }
          case 'unknown': {
            setStage('nand', 'warn', `JEDEC ID ${idHex} 不在识别表中,该型号可能不受支持`)
            appendLog(`NAND ID ${idHex} 未匹配到型号`)
            break
          }
        }
      } catch (error_: unknown) {
        const msg = error_ instanceof Error ? error_.message : String(error_)
        setStage('nand', 'fail', `检测出错:${msg}`)
        appendLog(`NAND 检测出错:${msg}`)
      }

      // 3. DDR
      // 首次进入 FEL 后第一笔大块 transferOut 偶发出错(与烧录页 FEL 阶段
      // 同一问题),USB 端口复位后重跑即可恢复
      setStage('ddr', 'running', '上传 DDR 初始化 payload 并执行…')
      try {
        let ddr
        for (let attempt = 1; ; attempt++) {
          try {
            ddr = await runDdrTest(fel!)
            break
          } catch (error_: unknown) {
            const msg = error_ instanceof Error ? error_.message : String(error_)
            if (attempt >= 3 || msg.includes('已断开')) {
              throw error_
            }
            appendLog(`DDR 传输出错(${msg}),复位设备后自动重试(第 ${attempt + 1}/3 次)…`)
            setStage('ddr', 'running', `传输出错,复位设备后重试(第 ${attempt + 1}/3 次)…`)
            await reconnectFel()
          }
        }
        const modelText = ddr.model ?? `未知型号(${ddr.sizeMb}MB)`
        if (ddr.memtestOk) {
          if (ddr.sizeMb === 64) {
            setStage('ddr', 'pass', `容量 ${ddr.sizeMb}MB → ${modelText},主机侧读写校验通过`)
          } else if (ddr.sizeMb === 32) {
            setStage('ddr', 'warn', `容量 32MB → F1C100S。本项目主控应为 F1C200S(64MB),请核对芯片丝印是否买错 / 焊错型号`)
          } else {
            setStage('ddr', 'warn', `容量 ${ddr.sizeMb}MB,不是预期的 64MB(F1C200S),请核对芯片型号`)
          }
          appendLog(`DDR 初始化成功,${ddr.sizeMb}MB,判定 ${modelText}`)
          parts.unshift(`${modelText} / DDR ${ddr.sizeMb}MB`)
        } else {
          setStage('ddr', 'warn', `信箱报告 ${ddr.sizeMb}MB,但主机侧读写校验失败,DDR 可能虚焊`)
          appendLog('DDR 校验失败')
        }
      } catch (error_: unknown) {
        const msg = error_ instanceof Error ? error_.message : String(error_)
        setStage('ddr', 'fail', msg)
        appendLog(`DDR 测试失败:${msg}`)
      }

      if (parts.length > 0) {
        summary.value = parts.join(',')
      }
    } finally {
      autoRunning.value = false
    }
  }

  // 断电/拔线后设备已不存在,不能再走正常 disconnect 的 USB 收尾
  function cleanupAfterDeviceLost () {
    navigator.usb.removeEventListener('disconnect', onUsbDisconnect)
    running = false
    loopPromise = null
    lradcActive.value = false
    lradcLoopPromise = null
    activePin.value = null
    toggleCount.value = 0
    opened = null
    fel = null
    tester = null
    connected.value = false
    transferLock.end()
  }

  function onUsbDisconnect (event: USBConnectionEvent) {
    if (!opened || event.device !== opened.device) {
      return
    }
    if (poweroffPending.value) {
      poweroffPending.value = false
      appendLog('检测到 USB 断开:板子已断电,关机电路正常')
      notify('板子已断电,关机电路正常', 'success')
    } else {
      appendLog('USB 已断开')
    }
    cleanupAfterDeviceLost()
  }

  async function triggerPoweroff () {
    if (!connected.value || !tester || autoRunning.value || poweroffPending.value) {
      return
    }
    await stopWave()
    await stopLradcTest()
    poweroffPending.value = true
    appendLog('拉高 PE2 触发断电,板子应在数秒内熄灭并断开 USB…')
    try {
      await tester.configOutput(POWEROFF_PIN)
      await tester.setLevel(POWEROFF_PIN, true)
    } catch {
      // 电源瞬间切断会让 USB 传输半途报错,属预期,等 disconnect 事件确认
    }
    setTimeout(() => {
      if (poweroffPending.value && connected.value) {
        poweroffPending.value = false
        appendLog('超时:板子仍未断电,PE2 关机电路可能虚焊或元件缺失')
        notify('板子未断电,关机电路可能有问题', 'warning')
      }
    }, POWEROFF_TIMEOUT_MS)
  }

  async function lradcPollLoop () {
    while (lradcActive.value && fel) {
      try {
        const raw = await lradcReadRaw(fel)
        lradcRaw.value = raw
        lradcVoltageUv.value = lradcRawToUv(raw)
        lradcKeyLabel.value = lradcMatchKey(lradcKeys.value, raw)?.label ?? null
      } catch (error_: unknown) {
        if (lradcActive.value) {
          const msg = error_ instanceof Error ? error_.message : String(error_)
          appendLog(`LRADC 读取出错:${msg}`)
          lradcActive.value = false
        }
        return
      }
      await sleep(100)
    }
  }

  async function startLradcTest () {
    if (!connected.value || !fel || autoRunning.value || lradcActive.value) {
      return
    }
    await stopWave()
    try {
      await lradcEnable(fel)
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      appendLog(`LRADC 使能失败:${msg}`)
      notify(msg, 'error')
      return
    }
    lradcRaw.value = null
    lradcVoltageUv.value = null
    lradcKeyLabel.value = null
    lradcActive.value = true
    appendLog('开始 LRADC 按键测试,请逐个按下面板按键')
    lradcLoopPromise = lradcPollLoop()
  }

  async function stopLradcTest () {
    if (!lradcActive.value) {
      return
    }
    lradcActive.value = false
    if (lradcLoopPromise) {
      await lradcLoopPromise
      lradcLoopPromise = null
    }
    if (fel) {
      try {
        await lradcDisable(fel)
      } catch {
        // 断开过程中收尾失败可忽略
      }
    }
    appendLog('已停止 LRADC 按键测试')
  }

  async function stopWave (restoreLow = true) {
    running = false
    if (loopPromise) {
      await loopPromise
      loopPromise = null
    }
    const pin = activePin.value
    if (restoreLow && pin && tester) {
      try {
        await tester.setLevel(pin, false)
      } catch {
        // 断开过程中收尾失败可忽略
      }
    }
    activePin.value = null
    toggleCount.value = 0
  }

  async function squareWave (pin: TestPin) {
    let level = true
    while (running && activePin.value?.key === pin.key) {
      try {
        await tester!.setLevel(pin, level)
        expected.value = level ? 1 : 0
        toggleCount.value++
      } catch (error_: unknown) {
        if (running) {
          const msg = error_ instanceof Error ? error_.message : String(error_)
          appendLog(`${pin.signal} (${pin.pinName}) 驱动出错:${msg}`)
          running = false
        }
        return
      }
      level = !level
      await sleep(HALF_PERIOD_MS)
    }
  }

  // 用户手动点选要测的脚;任意时刻只驱动一个脚
  async function selectPin (pin: TestPin) {
    if (!connected.value || !tester || autoRunning.value) {
      return
    }
    await stopWave()
    await stopLradcTest()
    try {
      await tester.configOutput(pin)
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      appendLog(`配置 ${pin.signal} (${pin.pinName}) 输出失败:${msg}`)
      notify(msg, 'error')
      return
    }
    activePin.value = pin
    toggleCount.value = 0
    appendLog(`开始测试 ${pin.signal} (${pin.pinName}),0.25Hz 方波`)
    running = true
    loopPromise = squareWave(pin)
  }

  async function stopTest () {
    await stopWave()
  }

  async function disconnect () {
    navigator.usb.removeEventListener('disconnect', onUsbDisconnect)
    poweroffPending.value = false
    await stopWave()
    await stopLradcTest()
    if (opened) {
      await closeUsb(opened)
      opened = null
    }
    fel = null
    tester = null
    connected.value = false
    transferLock.end()
    appendLog('已断开')
  }

  return {
    isSupported,
    connected,
    connecting,
    error,
    logs,
    selectedRev,
    pins,
    stages,
    autoRunning,
    summary,
    activePin,
    expected,
    toggleCount,
    lradcActive,
    lradcRaw,
    lradcVoltageUv,
    lradcKeyLabel,
    lradcKeys,
    supportsPoweroff,
    poweroffPending,
    connect,
    runAutoTest,
    selectPin,
    stopTest,
    startLradcTest,
    stopLradcTest,
    triggerPoweroff,
    disconnect,
  }
}

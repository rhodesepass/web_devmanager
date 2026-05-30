import { ref, type Ref } from 'vue'
import type { UsbResponderClient } from '@/usb'
import { useNotifications } from './useNotifications'

export interface TerminalLine {
  type: 'input' | 'stdout' | 'stderr' | 'info' | 'exit'
  text: string
  timestamp: Date
}

const decoder = new TextDecoder()

export function useTerminal (client: Ref<UsbResponderClient | null>) {
  const { notify } = useNotifications()
  const commandInput = ref('')
  const lines = ref<TerminalLine[]>([])
  const executing = ref(false)
  const commandHistory = ref<string[]>([])
  const historyIndex = ref(-1)

  async function execute (cmd?: string) {
    const command = cmd ?? commandInput.value.trim()
    if (!command || !client.value) return
    commandInput.value = ''
    commandHistory.value.push(command)
    historyIndex.value = commandHistory.value.length

    lines.value.push({ type: 'input', text: `$ ${command}`, timestamp: new Date() })
    executing.value = true
    try {
      const result = await client.value.commandExec(command, { timeoutMs: 30_000 })
      if (result.stdout.length > 0) {
        lines.value.push({
          type: 'stdout',
          text: decoder.decode(result.stdout).replace(/\n$/, ''),
          timestamp: new Date(),
        })
      }
      if (result.stderr.length > 0) {
        lines.value.push({
          type: 'stderr',
          text: decoder.decode(result.stderr).replace(/\n$/, ''),
          timestamp: new Date(),
        })
      }
      if (result.timedOut) {
        lines.value.push({
          type: 'info',
          text: `[超时 ${result.durationMs}ms]`,
          timestamp: new Date(),
        })
      }
      lines.value.push({
        type: 'exit',
        text: `[退出码: ${result.exitCode}]`,
        timestamp: new Date(),
      })
    } catch (e: any) {
      lines.value.push({ type: 'stderr', text: `错误: ${e.message}`, timestamp: new Date() })
      notify(`命令执行失败: ${e.message}`, 'error')
    } finally {
      executing.value = false
    }
  }

  function onKeydown (e: KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (historyIndex.value > 0) {
        historyIndex.value--
        commandInput.value = commandHistory.value[historyIndex.value]
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex.value < commandHistory.value.length - 1) {
        historyIndex.value++
        commandInput.value = commandHistory.value[historyIndex.value]
      } else {
        historyIndex.value = commandHistory.value.length
        commandInput.value = ''
      }
    }
  }

  function clear () {
    lines.value = []
  }

  return {
    commandInput,
    lines,
    executing,
    execute,
    onKeydown,
    clear,
  }
}

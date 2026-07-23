import { computed, ref, watch } from 'vue'
import {
  PCB_ORDER_STEPS,
  REPRO_CASE,
  REPRO_FILES,
  REPRO_TOOLS,
} from '@/config/reproGuide'

const STORAGE_KEY = 'repro-guide-progress'

/** 各步骤要计入完成度的必做勾选项 id(BOM 步/焊接步各自单独一个勾) */
const STEP_REQUIRED: Record<string, string[]> = {
  tools: [
    ...REPRO_TOOLS.filter(i => !i.optional).map(i => i.id),
    ...REPRO_FILES.filter(i => !i.optional).map(i => i.id),
  ],
  pcb: PCB_ORDER_STEPS.filter(i => !i.optional).map(i => i.id),
  bom: ['bom-ordered', 'screen-bought'],
  case: REPRO_CASE.filter(i => !i.optional).map(i => i.id),
  solder: ['solder-done'],
  systest: ['systest-done'],
}

function load (): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return new Set(JSON.parse(raw) as string[])
    }
  } catch {
    // 存储不可用或数据损坏时从空开始
  }
  return new Set()
}

export function useReproGuide () {
  const checked = ref<Set<string>>(load())
  const currentStep = ref(0)

  watch(checked, value => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...value]))
    } catch {
      // 无痕模式等写入失败可忽略
    }
  }, { deep: true })

  function isChecked (id: string): boolean {
    return checked.value.has(id)
  }

  function toggle (id: string, value?: boolean) {
    const next = new Set(checked.value)
    const want = value ?? !next.has(id)
    if (want) {
      next.add(id)
    } else {
      next.delete(id)
    }
    checked.value = next
  }

  function stepDone (stepKey: string): boolean {
    const req = STEP_REQUIRED[stepKey]
    return !!req && req.length > 0 && req.every(id => checked.value.has(id))
  }

  function stepProgress (stepKey: string): { done: number, total: number } {
    const req = STEP_REQUIRED[stepKey] ?? []
    return {
      done: req.filter(id => checked.value.has(id)).length,
      total: req.length,
    }
  }

  function reset () {
    checked.value = new Set()
    currentStep.value = 0
  }

  const allDone = computed(() =>
    Object.keys(STEP_REQUIRED).every(k => stepDone(k)),
  )

  return {
    checked,
    currentStep,
    isChecked,
    toggle,
    stepDone,
    stepProgress,
    reset,
    allDone,
  }
}

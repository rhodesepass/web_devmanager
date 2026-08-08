<template>
  <div class="scrub" :class="{ 'scrub--disabled': disabled }">
    <span class="scrub-label">{{ label }}</span>

    <input
      v-if="editing"
      :ref="focusInput"
      class="scrub-input"
      type="number"
      :value="displayValue"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.esc="editing = false"
    >

    <span
      v-else
      class="scrub-value"
      title="按住左右拖动微调；单击输入数值"
      @pointerdown="onDown"
    >{{ displayValue }}</span>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'

  const props = withDefaults(defineProps<{
    label: string
    modelValue: number
    /** 每拖动 1px 的增量 */
    step?: number
    min?: number
    max?: number
    decimals?: number
    disabled?: boolean
  }>(), {
    step: 1,
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY,
    decimals: 2,
  })

  const emit = defineEmits<{ 'update:modelValue': [number] }>()

  const editing = ref(false)

  const displayValue = computed(() => {
    const v = props.modelValue
    return Number.isFinite(v) ? Number(v.toFixed(props.decimals)).toString() : '0'
  })

  function clamp (v: number): number {
    return Math.min(Math.max(v, props.min), props.max)
  }

  function onDown (event: PointerEvent) {
    if (props.disabled || event.button !== 0) {
      return
    }
    event.preventDefault()
    const startX = event.clientX
    const startValue = props.modelValue
    let dragging = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (!dragging && Math.abs(dx) < 3) {
        return
      }
      dragging = true
      // Shift 粗调 ×10，Alt 细调 ÷10
      const scale = ev.shiftKey ? 10 : (ev.altKey ? 0.1 : 1)
      emit('update:modelValue', clamp(startValue + dx * props.step * scale))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!dragging) {
        editing.value = true
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function focusInput (el: unknown) {
    if (el instanceof HTMLInputElement) {
      el.focus()
      el.select()
    }
  }

  function commit (event: Event) {
    const v = Number((event.target as HTMLInputElement).value)
    if (Number.isFinite(v)) {
      emit('update:modelValue', clamp(v))
    }
    editing.value = false
  }
</script>

<style scoped>
.scrub {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.scrub--disabled {
  opacity: 0.4;
  pointer-events: none;
}

.scrub-label {
  font-size: 11px;
  opacity: 0.55;
  user-select: none;
}

.scrub-value {
  font-size: 13px;
  font-family: monospace;
  color: #8ab4f8;
  cursor: ew-resize;
  user-select: none;
  padding: 1px 3px;
  border-radius: 3px;
  touch-action: none;
}

.scrub-value:hover {
  background: rgba(138, 180, 248, 0.15);
}

.scrub-input {
  width: 72px;
  font-size: 13px;
  font-family: monospace;
  background: rgba(127, 127, 127, 0.15);
  border: 1px solid rgba(138, 180, 248, 0.6);
  border-radius: 3px;
  padding: 0 4px;
  outline: none;
  color: inherit;
}

/* 隐藏 number input 的步进箭头，保持紧凑 */
.scrub-input::-webkit-outer-spin-button,
.scrub-input::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
</style>

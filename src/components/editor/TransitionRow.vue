<template>
  <div>
    <div class="text-body-2 mb-1">{{ label }}</div>

    <div class="d-flex ga-2 align-center flex-wrap">
      <v-select
        density="compact"
        :disabled="disabled"
        hide-details
        :items="typeOptions"
        label="过渡类型"
        :model-value="modelValue?.type ?? 'none'"
        style="max-width: 150px"
        variant="outlined"
        @update:model-value="onTypeChange"
      />

      <template v-if="modelValue">
        <v-text-field
          density="compact"
          :disabled="disabled"
          hide-details
          label="每步时长(ms)"
          :model-value="modelValue.durationUs / 1000"
          style="max-width: 120px"
          type="number"
          variant="outlined"
          @change="onDurationChange"
        />

        <input
          class="color-input"
          :disabled="disabled"
          type="color"
          :value="modelValue.backgroundColor"
          @input="onColorChange"
        >
      </template>

      <span v-if="hint" class="text-caption text-medium-emphasis">{{ hint }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { TransitionLoopConfig, TransitionType } from '@/editor-core/model'

  const props = defineProps<{
    label: string
    modelValue: TransitionLoopConfig | null
    hint?: string
    disabled?: boolean
  }>()

  const emit = defineEmits<{ 'update:modelValue': [TransitionLoopConfig | null] }>()

  const typeOptions: { title: string, value: TransitionType | 'none' }[] = [
    { title: '硬切', value: 'none' },
    { title: 'fade 交叉渐变', value: 'fade' },
    { title: 'move 贝塞尔移动', value: 'move' },
    { title: 'swipe 扫掠', value: 'swipe' },
  ]

  function onTypeChange (value: unknown) {
    if (value === 'none') {
      emit('update:modelValue', null)
      return
    }
    if (value !== 'fade' && value !== 'move' && value !== 'swipe') {
      return
    }
    emit('update:modelValue', {
      type: value satisfies TransitionType,
      durationUs: props.modelValue?.durationUs ?? 500_000,
      backgroundColor: props.modelValue?.backgroundColor ?? '#000000',
    })
  }

  function onDurationChange (event: Event) {
    const ms = Number((event.target as HTMLInputElement).value)
    if (props.modelValue && Number.isFinite(ms) && ms > 0) {
      emit('update:modelValue', { ...props.modelValue, durationUs: Math.round(ms * 1000) })
    }
  }

  function onColorChange (event: Event) {
    if (props.modelValue) {
      emit('update:modelValue', {
        ...props.modelValue,
        backgroundColor: (event.target as HTMLInputElement).value,
      })
    }
  }
</script>

<style scoped>
.color-input {
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
</style>

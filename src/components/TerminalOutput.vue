<template>
  <v-card
    ref="cardRef"
    variant="outlined"
    class="terminal-card overflow-y-auto"
    height="100%"
  >
    <v-card-text class="pa-3">
      <div v-for="(line, i) in lines" :key="i" class="terminal-line">
        <span :class="lineClass(line.type)">{{ line.text }}</span>
      </div>
      <div v-if="lines.length === 0" class="text-grey">
        在下方输入命令以在设备上执行。
      </div>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import { ref, watch, nextTick } from 'vue'
import type { TerminalLine } from '@/composables/useTerminal'

const props = defineProps<{ lines: TerminalLine[] }>()

const cardRef = ref<any>(null)

watch(() => props.lines.length, async () => {
  await nextTick()
  const el = cardRef.value?.$el ?? cardRef.value
  if (el) el.scrollTop = el.scrollHeight
})

function lineClass (type: string) {
  switch (type) {
    case 'input': return 'text-primary font-weight-bold'
    case 'stderr': return 'text-error'
    case 'exit': return 'text-grey'
    case 'info': return 'text-info font-italic'
    default: return ''
  }
}
</script>

<style scoped>
.terminal-card {
  font-family: 'Roboto Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: rgb(var(--v-theme-surface));
}
.terminal-line {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

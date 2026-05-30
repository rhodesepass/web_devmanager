<template>
  <v-card
    ref="cardRef"
    variant="outlined"
    class="terminal-card overflow-y-auto"
    height="100%"
  >
    <v-card-text class="terminal-card__body pa-3">
      <div v-for="(line, i) in lines" :key="i" class="terminal-line">
        <span :class="lineClass(line.type)">{{ line.text }}</span>
      </div>
      <div
        v-if="lines.length === 0"
        class="terminal-empty"
        :class="{ 'terminal-empty--centered': !ready }"
      >
        <template v-if="ready">
          <span class="text-grey">在下方输入命令以在设备上执行。</span>
        </template>
        <template v-else>
          <v-icon color="primary" icon="mdi-usb-port" size="48" class="mb-3" />
          <div class="text-body-1">请先连接设备</div>
          <div class="text-body-2 text-medium-emphasis mt-1">
            连接后即可在设备上执行 Shell 命令
          </div>
        </template>
      </div>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import { ref, watch, nextTick } from 'vue'
import type { TerminalLine } from '@/composables/useTerminal'

const props = withDefaults(defineProps<{
  lines: TerminalLine[]
  ready?: boolean
}>(), {
  ready: true,
})

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
.terminal-card__body {
  height: 100%;
}

.terminal-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.terminal-empty--centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  text-align: center;
}
</style>

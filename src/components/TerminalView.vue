<template>
  <div class="terminal-view d-flex flex-column flex-grow-1">
    <div class="d-flex align-center flex-shrink-0 mb-2">
      <v-btn
        icon="mdi-delete-sweep"
        variant="text"
        size="small"
        @click="clear"
      />
      <v-chip v-if="executing" color="primary" variant="tonal" size="small" class="ml-2">
        <v-progress-circular indeterminate size="12" width="2" class="mr-1" />
        执行中...
      </v-chip>
    </div>

    <div class="terminal-output flex-grow-1 mb-2">
      <TerminalOutput :lines="lines" :ready="!!client" />
    </div>

    <div class="terminal-input flex-shrink-0 d-flex align-center ga-2">
      <v-icon class="text-medium-emphasis" icon="mdi-chevron-right" size="small" />
      <v-text-field
        ref="inputRef"
        v-model="commandInput"
        autocomplete="off"
        :autofocus="!!client"
        class="flex-grow-1"
        density="compact"
        hide-details
        :placeholder="client ? '例如 uname -a' : '请先连接设备'"
        single-line
        variant="solo-filled"
        flat
        :disabled="!client"
        :loading="executing"
        @keydown.enter.prevent="runCommand()"
        @keydown="onKeydown"
      />
      <v-btn
        icon="mdi-send"
        size="small"
        variant="tonal"
        :disabled="!client || executing || !commandInput.trim()"
        @click="runCommand()"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { nextTick, ref, toRef } from 'vue'
import type { VTextField } from 'vuetify/components'
import type { UsbResponderClient } from '@/usb'
import { useTerminal } from '@/composables/useTerminal'
import TerminalOutput from './TerminalOutput.vue'

const props = defineProps<{ client: UsbResponderClient | null }>()

const { commandInput, lines, executing, execute, onKeydown, clear } = useTerminal(
  toRef(props, 'client'),
)

const inputRef = ref<VTextField | null>(null)

async function runCommand () {
  await execute()
  await nextTick()
  inputRef.value?.focus()
}
</script>

<style scoped>
.terminal-view {
  min-height: 0;
}

.terminal-output {
  min-height: 0;
  overflow: hidden;
}

.terminal-input :deep(.v-field) {
  --v-field-padding-top: 4px;
  --v-field-padding-bottom: 4px;
}
</style>

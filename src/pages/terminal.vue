<template>
  <div class="terminal-page d-flex flex-column">
    <PageHeader
      title="虚拟终端"
      subtitle="通过设备串口进行交互式调试"
    />

    <v-alert
      v-if="!connected"
      type="info"
      variant="tonal"
      class="mb-4 flex-shrink-0"
    >
      请先连接设备。
    </v-alert>

    <TerminalView v-else :client="client" class="flex-grow-1" />
  </div>
</template>

<script lang="ts" setup>
import { useUsb } from '@/composables/useUsb'
import TerminalView from '@/components/TerminalView.vue'
import PageHeader from '@/components/PageHeader.vue'

const { connected, client } = useUsb()
</script>

<style scoped>
.terminal-page {
  height: calc(100vh - 120px);
  min-height: 360px;
}
</style>

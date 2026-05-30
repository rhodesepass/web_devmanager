<template>
  <div class="terminal-page d-flex flex-column">
    <PageHeader
      title="虚拟终端"
      subtitle="通过设备串口进行交互式调试"
    />

    <TerminalView :client="client" class="flex-grow-1" />
  </div>
</template>

<script lang="ts" setup>
import { useUsb } from '@/composables/useUsb'
import TerminalView from '@/components/TerminalView.vue'
import PageHeader from '@/components/PageHeader.vue'

const { client } = useUsb()
</script>

<style scoped>
.terminal-page {
  height: calc(100vh - 120px);
  min-height: 360px;
}
</style>

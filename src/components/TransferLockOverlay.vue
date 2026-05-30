<template>
  <v-dialog
    :model-value="active"
    persistent
    no-click-animation
    :scrim="true"
    width="420"
    :z-index="4000"
  >
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-progress-circular
          v-if="percent == null"
          color="primary"
          indeterminate
          size="24"
          width="2"
        />
        <v-icon v-else color="primary" icon="mdi-transfer" />
        {{ snapshot?.title }}
      </v-card-title>

      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          传输进行中，请勿切换页面或进行其他操作。
        </p>

        <p v-if="snapshot?.detail" class="text-body-2 mb-3 text-truncate">
          {{ snapshot.detail }}
        </p>

        <v-progress-linear
          v-if="percent != null"
          color="primary"
          height="8"
          :model-value="percent"
          rounded
        />

        <p
          v-if="snapshot && snapshot.total > 0"
          class="text-caption text-medium-emphasis mt-2"
        >
          {{ formatBytes(snapshot.bytes) }} / {{ formatBytes(snapshot.total) }}
        </p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { computed } from 'vue'
  import { useTransferLock } from '@/composables/useTransferLock'
  import { formatBytes } from '@/utils/format'

  const { lock, active, percent } = useTransferLock()

  const snapshot = computed(() => lock.value)
</script>

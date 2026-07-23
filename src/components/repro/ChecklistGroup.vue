<template>
  <div>
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="d-flex align-start py-1"
    >
      <v-checkbox
        color="primary"
        density="compact"
        hide-details
        :model-value="isChecked(item.id)"
        @update:model-value="emit('toggle', item.id, !!$event)"
      />

      <div class="repro-check__text pt-1">
        <div class="text-body-2">
          <span v-if="ordered" class="text-medium-emphasis mr-1">{{ index + 1 }}.</span>
          {{ item.label }}
          <span v-if="item.optional" class="text-caption text-medium-emphasis">（选做）</span>
        </div>

        <div v-if="item.hint" class="text-caption text-medium-emphasis">
          {{ item.hint }}
        </div>

        <a
          v-if="item.link"
          class="text-caption"
          :href="item.link.url"
          rel="noopener"
          target="_blank"
        >
          {{ item.link.text }}
          <v-icon icon="mdi-open-in-new" size="12" />
        </a>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { ChecklistItem } from '@/config/reproGuide'

  defineProps<{
    items: ChecklistItem[]
    isChecked: (id: string) => boolean
    ordered?: boolean
  }>()

  const emit = defineEmits<{
    toggle: [id: string, value: boolean]
  }>()
</script>

<style scoped>
.repro-check__text {
  min-width: 0;
}
</style>

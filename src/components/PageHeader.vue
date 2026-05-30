<template>
  <header class="page-header mb-6">
    <h1 class="text-h5 font-weight-medium mb-0">
      {{ title }}
    </h1>
    <p
      v-if="subtitle"
      class="text-body-2 text-medium-emphasis mt-1 mb-0"
    >
      {{ subtitle }}
    </p>
  </header>
</template>

<script lang="ts" setup>
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

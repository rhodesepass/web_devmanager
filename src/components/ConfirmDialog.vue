<template>
  <v-dialog :model-value="modelValue" max-width="360" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>{{ message }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">取消</v-btn>
        <v-btn color="error" @click="$emit('confirm'); $emit('update:modelValue', false)">
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
defineProps<{
  modelValue: boolean
  title: string
  message: string
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()
</script>

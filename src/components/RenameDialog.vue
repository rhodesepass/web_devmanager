<template>
  <v-dialog :model-value="modelValue" max-width="400" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          :label="label"
          autofocus
          @keyup.enter="onConfirm"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">取消</v-btn>
        <v-btn color="primary" :disabled="!name.trim()" @click="onConfirm">
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  label: string
  initialValue?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [name: string]
}>()

const name = ref('')

watch(() => props.modelValue, (val) => {
  if (val) name.value = props.initialValue ?? ''
})

function onConfirm () {
  const trimmed = name.value.trim()
  if (trimmed) {
    emit('confirm', trimmed)
    emit('update:modelValue', false)
  }
}
</script>

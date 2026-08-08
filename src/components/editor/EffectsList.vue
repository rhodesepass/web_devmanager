<template>
  <div>
    <div class="d-flex align-center mb-1">
      <div class="text-body-2">特效</div>

      <v-spacer />

      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            density="compact"
            prepend-icon="mdi-plus"
            size="x-small"
            variant="tonal"
          >
            添加
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="type in availableTypes"
            :key="type"
            :title="EFFECTS[type].label"
            @click="addEffect(clip.id, type)"
          />
          <v-list-item v-if="availableTypes.length === 0" disabled title="全部特效已添加" />
        </v-list>
      </v-menu>
    </div>

    <div v-if="clip.effects.length === 0" class="text-caption text-medium-emphasis">
      无特效。参数为静态值（不随时间变化）；模糊以画布像素计。
    </div>

    <div v-for="fx in clip.effects" :key="fx.id" class="fx-row">
      <div class="d-flex align-center">
        <span class="text-caption">{{ EFFECTS[fx.type].label }}</span>
        <span class="text-caption text-medium-emphasis ml-1">{{ paramLabel(fx) }}</span>

        <v-spacer />

        <v-btn
          density="compact"
          icon="mdi-restore"
          size="x-small"
          title="重置为默认值"
          variant="text"
          @click="resetEffect(fx)"
        />
        <v-btn
          density="compact"
          icon="mdi-close"
          size="x-small"
          title="删除特效"
          variant="text"
          @click="removeEffect(clip.id, fx.id)"
        />
      </div>

      <v-slider
        v-for="param in EFFECTS[fx.type].params"
        :key="param.key"
        density="compact"
        hide-details
        :max="param.max"
        :min="param.min"
        :model-value="fx.params[param.key] ?? param.default"
        :step="param.step"
        @update:model-value="updateEffectParams(clip.id, fx.id, { [param.key]: $event })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { Clip, EffectInstance, EffectType } from '@/editor-core/model'
  import { computed } from 'vue'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { EFFECT_TYPES, EFFECTS } from '@/editor-core/effects'

  const props = defineProps<{ clip: Clip }>()

  const { addEffect, updateEffectParams, removeEffect } = useEditorProject()

  const availableTypes = computed<EffectType[]>(() =>
    EFFECT_TYPES.filter(t => !props.clip.effects.some(fx => fx.type === t)))

  function paramLabel (fx: EffectInstance): string {
    const def = EFFECTS[fx.type]
    return def.params
      .map(p => `${(fx.params[p.key] ?? p.default).toFixed(p.step < 1 ? 2 : 0)}${p.unit}`)
      .join(' ')
  }

  function resetEffect (fx: EffectInstance) {
    const def = EFFECTS[fx.type]
    const params: Record<string, number> = {}
    for (const p of def.params) {
      params[p.key] = p.default
    }
    updateEffectParams(props.clip.id, fx.id, params)
  }
</script>

<style scoped>
.fx-row {
  padding: 4px 0;
  border-bottom: 1px dashed rgba(127, 127, 127, 0.2);
}
</style>

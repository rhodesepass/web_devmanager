<template>
  <v-card class="pa-3" variant="tonal">
    <div class="text-body-1 mb-3">过渡配置</div>

    <template v-if="project.introEnabled">
      <TransitionRow
        hint="从上一干员素材切换到入场段"
        label="上一干员 → 入场"
        :model-value="project.transitionIn"
        @update:model-value="project.transitionIn = $event"
      />

      <v-divider class="my-3" />

      <TransitionRow
        hint="入场段结束 → 循环段；总时长 = 3×每步，建议每步 ≥300ms"
        label="入场 → 循环"
        :model-value="project.transitionLoop"
        @update:model-value="project.transitionLoop = $event"
      />
    </template>

    <template v-else>
      <TransitionRow
        hint="从上一干员素材切换到循环段（未启用入场段）"
        label="上一干员 → 循环"
        :model-value="project.transitionIn"
        @update:model-value="project.transitionIn = $event"
      />

      <div class="text-caption text-medium-emphasis mt-3">
        启用入场段后，可另外配置「入场 → 循环」的过渡
      </div>
    </template>

    <v-alert
      v-if="scheduleBad"
      class="mt-3"
      density="compact"
      type="warning"
      variant="tonal"
    >
      入场时长必须大于 2×入场过渡 + 循环过渡每步时长，否则设备端会钳到 100ms 并报错
    </v-alert>
  </v-card>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { introScheduleOk } from '@/editor-core/model'
  import TransitionRow from './TransitionRow.vue'

  const { project } = useEditorProject()

  const scheduleBad = computed(() => !introScheduleOk(project.value))
</script>

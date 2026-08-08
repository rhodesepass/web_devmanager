<template>
  <v-card class="pa-3" variant="tonal">
    <div class="text-body-1 mb-3">视频配置</div>

    <div class="d-flex align-center">
      <v-icon class="mr-2" icon="mdi-restart" size="20" />
      <span class="text-body-2">LOOP 循环段</span>

      <v-spacer />

      <v-btn
        color="primary"
        prepend-icon="mdi-movie-edit-outline"
        size="small"
        variant="tonal"
        @click="router.push('/editor/cut/loop')"
      >
        进入剪辑
      </v-btn>
    </div>

    <div class="text-caption text-medium-emphasis mt-1">
      素材主体，循环播放；首帧应与末帧衔接
    </div>

    <div class="d-flex ga-2 mt-2">
      <v-chip size="small" variant="tonal">时长 {{ (loopDurationUs / 1_000_000).toFixed(2) }}s（自动）</v-chip>
      <v-chip size="small" variant="tonal">{{ loopStats }}</v-chip>
    </div>

    <v-divider class="my-3" />

    <div class="d-flex align-center">
      <v-icon class="mr-2" icon="mdi-movie-open-play-outline" size="20" />
      <span class="text-body-2">INTRO 入场段</span>

      <v-switch
        class="ml-3"
        color="primary"
        density="compact"
        hide-details
        :model-value="project.introEnabled"
        @update:model-value="project.introEnabled = $event === true"
      />

      <v-spacer />

      <v-btn
        color="primary"
        :disabled="!project.introEnabled"
        prepend-icon="mdi-movie-edit-outline"
        size="small"
        variant="tonal"
        @click="router.push('/editor/cut/intro')"
      >
        进入剪辑
      </v-btn>
    </div>

    <div class="text-caption text-medium-emphasis mt-1">
      切到本素材时播一次，之后进入循环段；可选，关闭则不导出
    </div>

    <div class="d-flex ga-2 mt-2">
      <v-chip :disabled="!project.introEnabled" size="small" variant="tonal">
        时长 {{ (introDurationUs / 1_000_000).toFixed(2) }}s（自动）
      </v-chip>

      <v-chip :disabled="!project.introEnabled" size="small" variant="tonal">{{ introStats }}</v-chip>
    </div>
  </v-card>
</template>

<script setup lang="ts">
  import type { Segment } from '@/editor-core/model'
  import { computed } from 'vue'
  import { useRouter } from 'vue-router'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { segmentDurationUs } from '@/editor-core/model'

  const router = useRouter()
  const { project } = useEditorProject()

  const loopDurationUs = computed(() => segmentDurationUs(project.value.segments.loop))
  const introDurationUs = computed(() => segmentDurationUs(project.value.segments.intro))

  function stats (seg: Segment): string {
    const clips = seg.tracks.reduce((sum, t) => sum + t.clips.length, 0)
    return `${seg.tracks.length} 轨 · ${clips} 片段`
  }

  const loopStats = computed(() => stats(project.value.segments.loop))
  const introStats = computed(() => stats(project.value.segments.intro))
</script>

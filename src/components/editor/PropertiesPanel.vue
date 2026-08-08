<template>
  <v-card class="pa-3" variant="tonal">
    <template v-if="sel">
      <div class="text-body-2 mb-2">片段（{{ assetName }}）</div>

      <div class="d-flex ga-2">
        <v-text-field
          density="compact"
          hide-details
          label="起点(s)"
          :model-value="round2(sel.clip.startUs / 1_000_000)"
          type="number"
          variant="outlined"
          @change="writeStart"
        />

        <v-text-field
          density="compact"
          disabled
          hide-details
          label="时长(s)"
          :model-value="round2(sel.clip.durationUs / 1_000_000)"
          variant="outlined"
        />
      </div>

      <div v-if="isVideo" class="text-caption text-medium-emphasis mt-1">
        源区间 {{ round2(sel.clip.trimInUs / 1_000_000) }}s ~
        {{ round2((sel.clip.trimInUs + sel.clip.durationUs * sel.clip.speed) / 1_000_000) }}s（拖片段边缘裁剪）
        <template v-if="Math.abs(sel.clip.speed - 1) > 0.001">
          · 速率 ×{{ sel.clip.speed.toFixed(2) }}
        </template>
      </div>

      <v-divider class="my-3" />

      <div class="d-flex align-center mb-2">
        <v-btn
          :color="sel.clip.animated ? 'primary' : undefined"
          density="compact"
          :icon="sel.clip.animated ? 'mdi-timer' : 'mdi-timer-off-outline'"
          size="x-small"
          :title="sel.clip.animated
            ? '动画已启用：编辑会在播放头处落关键帧（点击关闭并丢弃动画）'
            : '静态摆放：编辑只改固定值。点击启用关键帧动画（PR 秒表）'"
          variant="text"
          @click="onToggleAnimated"
        />

        <div class="text-body-2 ml-1">
          变换<template v-if="sel.clip.animated"> @ {{ ((playheadUs - sel.clip.startUs) / 1_000_000).toFixed(2) }}s</template>
        </div>

        <v-btn
          class="ml-1"
          density="compact"
          :disabled="editDisabled"
          icon="mdi-restore"
          size="x-small"
          title="重置变换（居中/等比 1/不旋转/不透明）"
          variant="text"
          @click="resetTransform"
        />

        <v-spacer />

        <v-btn
          v-if="sel.clip.animated && !clipActive"
          density="compact"
          size="x-small"
          variant="text"
          @click="seek(sel.clip.startUs)"
        >
          跳到片段起点
        </v-btn>
      </div>

      <v-alert
        v-if="sel.clip.animated && !clipActive"
        class="mb-2"
        density="compact"
        type="info"
        variant="tonal"
      >
        播放头不在此片段内，关键帧编辑已禁用
      </v-alert>

      <template v-if="sampled">
        <div class="prop-grid">
          <ScrubNumber
            :decimals="1"
            :disabled="editDisabled"
            label="位置 X"
            :model-value="sampled.x"
            :step="1"
            @update:model-value="writeValue('x', $event)"
          />

          <ScrubNumber
            :decimals="1"
            :disabled="editDisabled"
            label="Y"
            :model-value="sampled.y"
            :step="1"
            @update:model-value="writeValue('y', $event)"
          />

          <ScrubNumber
            :decimals="1"
            :disabled="editDisabled"
            label="旋转°"
            :model-value="sampled.rotation"
            :step="0.5"
            @update:model-value="writeValue('rotation', $event)"
          />

          <ScrubNumber
            :decimals="2"
            :disabled="editDisabled"
            label="不透明"
            :max="1"
            :min="0"
            :model-value="sampled.opacity"
            :step="0.005"
            @update:model-value="writeValue('opacity', $event)"
          />
        </div>

        <div class="d-flex align-center ga-2 mt-2">
          <ScrubNumber
            :decimals="3"
            :disabled="editDisabled"
            label="缩放 X"
            :min="0.01"
            :model-value="sampled.scaleX"
            :step="0.01"
            @update:model-value="writeScale('scaleX', $event)"
          />

          <v-btn
            density="compact"
            :disabled="editDisabled"
            :icon="scaleLinked ? 'mdi-link-variant' : 'mdi-link-variant-off'"
            size="x-small"
            :title="scaleLinked ? '等比缩放已锁定（点击解锁）' : '已解锁，X/Y 独立缩放'"
            variant="text"
            @click="scaleLinked = !scaleLinked"
          />

          <ScrubNumber
            :decimals="3"
            :disabled="editDisabled"
            label="Y"
            :min="0.01"
            :model-value="sampled.scaleY"
            :step="0.01"
            @update:model-value="writeScale('scaleY', $event)"
          />
        </div>

        <template v-if="sel.clip.animated">
          <v-select
            class="mt-2"
            density="compact"
            :disabled="editDisabled"
            hide-details
            :items="easingOptions"
            label="缓动（本帧→下一帧）"
            :model-value="currentEasing"
            variant="outlined"
            @update:model-value="writeEasing"
          />

          <v-btn
            block
            class="mt-3"
            :disabled="editDisabled"
            prepend-icon="mdi-rhombus-medium"
            size="small"
            variant="tonal"
            @click="dropKeyframe"
          >
            在当前时间落关键帧
          </v-btn>
        </template>

        <div v-else class="text-caption text-medium-emphasis mt-2">
          静态摆放：数值全时段生效。点击秒表启用关键帧动画。
        </div>
      </template>

      <v-divider class="my-3" />

      <EffectsList :clip="sel.clip" />

      <v-divider class="my-3" />

      <div class="text-body-2 mb-2">入点过渡</div>

      <v-select
        density="compact"
        hide-details
        :items="transitionOptions"
        :model-value="sel.clip.transitionIn?.type ?? 'none'"
        variant="outlined"
        @update:model-value="writeTransitionType"
      />

      <v-text-field
        v-if="sel.clip.transitionIn"
        class="mt-2"
        density="compact"
        hide-details
        label="过渡时长(ms)"
        :model-value="Math.round(sel.clip.transitionIn.durationUs / 1000)"
        type="number"
        variant="outlined"
        @change="writeTransitionDuration"
      />

      <div v-if="crossfadeOrphan" class="text-caption text-warning mt-1">
        前邻片段不紧贴，叠化将退化为从黑渐入
      </div>
    </template>

    <template v-else>
      <div class="text-body-2 mb-2">{{ activeSegmentId === 'intro' ? '入场段' : '循环段' }}</div>

      <div class="text-caption text-medium-emphasis">
        时长 {{ (activeSegmentDurationUs / 1_000_000).toFixed(2) }}s（由内容决定）<br>
        {{ clipCount }} 个片段
      </div>

      <div class="text-caption text-medium-emphasis mt-3">
        在画布或时间轴中选中一个片段以编辑变换/特效/过渡
      </div>
    </template>
  </v-card>
</template>

<script setup lang="ts">
  import type { ClipTransitionType, Easing, Keyframe } from '@/editor-core/model'
  import { computed, ref } from 'vue'
  import { useEditorPlayback } from '@/composables/useEditorPlayback'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { adjacentPrevClip, findKeyframeIndex, sampleClip } from '@/editor-core/interpolate'
  import { clipEndUs } from '@/editor-core/model'
  import EffectsList from './EffectsList.vue'
  import ScrubNumber from './ScrubNumber.vue'

  const {
    project,
    activeSegment,
    activeSegmentId,
    activeSegmentDurationUs,
    selectedClip,
    setKeyframe,
    setStaticTransform,
    toggleAnimated,
    moveClip,
    setTransitionIn,
    getAsset,
  } = useEditorProject()

  const projectCanvas = computed(() => project.value.canvas)
  const { playheadUs, seek } = useEditorPlayback()

  const easingOptions: { title: string, value: Easing }[] = [
    { title: 'linear', value: 'linear' },
    { title: 'easeIn', value: 'easeIn' },
    { title: 'easeOut', value: 'easeOut' },
    { title: 'easeInOut', value: 'easeInOut' },
  ]

  const transitionOptions: { title: string, value: string }[] = [
    { title: '无（硬切）', value: 'none' },
    { title: '闪黑', value: 'dipToBlack' },
    { title: '闪白', value: 'dipToWhite' },
    { title: '叠化', value: 'crossfade' },
  ]

  const sel = computed(() => selectedClip.value)

  const assetName = computed(() => sel.value ? (getAsset(sel.value.clip.assetId)?.name ?? '?') : '')
  const isVideo = computed(() => sel.value ? getAsset(sel.value.clip.assetId)?.kind === 'video' : false)

  const clipCount = computed(() =>
    activeSegment.value.tracks.reduce((sum, t) => sum + t.clips.length, 0))

  const localUs = computed(() => sel.value ? playheadUs.value - sel.value.clip.startUs : 0)

  const clipActive = computed(() => {
    const s = sel.value
    return !!s && playheadUs.value >= s.clip.startUs && playheadUs.value < clipEndUs(s.clip)
  })

  /** 静态模式任何时候可编辑（值全时段生效）；动画模式需要播放头在片段内 */
  const editDisabled = computed(() => !!sel.value?.clip.animated && !clipActive.value)

  function onToggleAnimated () {
    const s = sel.value
    if (s) {
      toggleAnimated(s.clip.id, localUs.value)
    }
  }

  const sampled = computed(() =>
    sel.value ? (sampleClip(sel.value.clip, Math.max(0, localUs.value)) ?? null) : null)

  /** 当前生效段的缓动 = 播放头左侧关键帧的 easing */
  const currentEasing = computed<Easing>(() => {
    const clip = sel.value?.clip
    if (!clip || clip.keyframes.length === 0) {
      return 'linear'
    }
    const i = findKeyframeIndex(clip.keyframes, localUs.value)
    return clip.keyframes[Math.max(0, i)].easing
  })

  const crossfadeOrphan = computed(() => {
    const s = sel.value
    return !!s && s.clip.transitionIn?.type === 'crossfade' && !adjacentPrevClip(s.track, s.clip)
  })

  function round2 (n: number) {
    return Math.round(n * 100) / 100
  }

  function buildKeyframe (): Keyframe | null {
    if (!sel.value || !sampled.value) {
      return null
    }
    const t = Math.round(localUs.value)
    const existing = sel.value.clip.keyframes.find(k => Math.abs(k.t - t) <= 1)
    return {
      t,
      ...sampled.value,
      easing: existing?.easing ?? currentEasing.value,
    }
  }

  function commitTransform (kf: Keyframe) {
    const s = sel.value
    if (!s) {
      return
    }
    if (s.clip.animated) {
      setKeyframe(s.clip.id, kf)
    } else {
      const { t: _t, easing: _e, ...state } = kf
      setStaticTransform(s.clip.id, state)
    }
  }

  function writeValue (field: keyof Omit<Keyframe, 't' | 'easing'>, value: number) {
    const kf = buildKeyframe()
    if (!kf || !sel.value || editDisabled.value || !Number.isFinite(value)) {
      return
    }
    kf[field] = field === 'opacity' ? Math.min(1, Math.max(0, value)) : value
    commitTransform(kf)
  }

  /** 等比锁定：改任一轴时另一轴按当前比例跟随 */
  const scaleLinked = ref(true)

  function writeScale (field: 'scaleX' | 'scaleY', value: number) {
    const kf = buildKeyframe()
    if (!kf || !sel.value || editDisabled.value || !Number.isFinite(value) || value <= 0) {
      return
    }
    if (scaleLinked.value && sampled.value) {
      const other = field === 'scaleX' ? 'scaleY' : 'scaleX'
      const cur = sampled.value[field]
      const ratio = cur > 0 ? sampled.value[other] / cur : 1
      kf[other] = value * ratio
    }
    kf[field] = value
    commitTransform(kf)
  }

  /** 重置变换：居中/等比 1/不旋转/不透明（动画模式在当前时间落帧，静态模式直接覆盖） */
  function resetTransform () {
    const s = sel.value
    if (!s || editDisabled.value) {
      return
    }
    const { width, height } = projectCanvas.value
    commitTransform({
      t: Math.round(Math.max(0, localUs.value)),
      x: width / 2,
      y: height / 2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      easing: currentEasing.value,
    })
  }

  function writeEasing (easing: Easing) {
    const clip = sel.value?.clip
    if (!clip || clip.keyframes.length === 0) {
      return
    }
    const i = Math.max(0, findKeyframeIndex(clip.keyframes, localUs.value))
    setKeyframe(clip.id, { ...clip.keyframes[i], easing })
  }

  function dropKeyframe () {
    const kf = buildKeyframe()
    if (kf && sel.value && clipActive.value) {
      setKeyframe(sel.value.clip.id, kf)
    }
  }

  function writeStart (event: Event) {
    const s = sel.value
    if (!s) {
      return
    }
    const sec = Number((event.target as HTMLInputElement).value)
    if (Number.isFinite(sec) && sec >= 0) {
      moveClip(s.clip.id, Math.round(sec * 1_000_000))
    }
  }

  function writeTransitionType (value: string) {
    const s = sel.value
    if (!s) {
      return
    }
    if (value === 'none') {
      setTransitionIn(s.clip.id, null)
      return
    }
    const durationUs = s.clip.transitionIn?.durationUs ?? 500_000
    setTransitionIn(s.clip.id, { type: value as ClipTransitionType, durationUs })
  }

  function writeTransitionDuration (event: Event) {
    const s = sel.value
    if (!s || !s.clip.transitionIn) {
      return
    }
    const ms = Number((event.target as HTMLInputElement).value)
    if (Number.isFinite(ms) && ms > 0) {
      setTransitionIn(s.clip.id, { ...s.clip.transitionIn, durationUs: Math.round(ms * 1000) })
    }
  }
</script>

<style scoped>
.prop-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}
</style>

<template>
  <v-dialog max-width="720" :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="pa-4">
      <div class="text-h6 mb-1">压制档位：{{ profile.label }}</div>

      <div class="text-body-2 text-medium-emphasis mb-3">
        由「压制预设 × 画布档位」决定；输出 {{ project.fps }}fps。
      </div>

      <div class="text-body-2 mb-1">为什么用这套参数</div>

      <div class="text-caption text-medium-emphasis mb-2">{{ profile.notes }}</div>

      <div class="text-body-2 mb-1">滤镜链（{{ profile.filter_chain }}）</div>

      <div class="text-caption text-medium-emphasis mb-2">{{ chain.comment }}</div>

      <div v-if="loopAssetApplies" class="text-caption text-medium-emphasis mb-2">
        另：当前 loop 段 ≤30s，导出时会自动叠加 <code>{{ loopAssetOption.x264_params_delta }}</code>
        —— {{ loopAssetOption.comment }}
      </div>

      <div class="text-body-2 mb-1">分段编码命令（每段 ≤{{ segFrames }} 帧，保证 concat copy 合法）</div>

      <pre class="cmd-block">ffmpeg -i seg.y4m \
  {{ encodeArgsPretty }} \
  segNNN.mp4</pre>

      <div class="text-body-2 mb-1 mt-2">合并命令</div>

      <pre class="cmd-block">ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart {{ outName }}</pre>

      <div class="text-caption text-medium-emphasis mt-2">
        threads/filter_threads 钳制是 wasm 环境约束（定长线程池），原生环境不需要；
        产物另经 stts 归一与 box 级合规校验（sample ≤512KB / avcC ≤64KB / CFR / 首帧 IDR）。
      </div>

      <div class="d-flex mt-3">
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">关闭</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { buildEncodeArgs, encodeProfiles, filterChains, loopAssetOption } from '@/config/encode-params'
  import { profileFor } from '@/editor-core/exporter'
  import { segmentDurationUs } from '@/editor-core/model'

  defineProps<{ modelValue: boolean }>()
  defineEmits<{ 'update:modelValue': [boolean] }>()

  const { project } = useEditorProject()

  const profileId = computed(() => profileFor({
    canvas: project.value.canvas,
    encodePreset: project.value.encodePreset,
  }))
  const profile = computed(() => encodeProfiles[profileId.value])
  const chain = computed(() => filterChains[profile.value.filter_chain])

  const loopAssetApplies = computed(() => {
    const dur = segmentDurationUs(project.value.segments.loop)
    return dur > 0 && dur <= 30_000_000
  })

  const segFrames = computed(() => (project.value.canvas.width >= 720 ? 125 : 250))
  const outName = computed(() => 'loop.mp4')

  /** 与导出实际使用的参数完全同源；仅为可读性把长值加引号并断行 */
  const encodeArgsPretty = computed(() => {
    const args = buildEncodeArgs(profileId.value, {
      loopAsset: loopAssetApplies.value,
      fps: project.value.fps,
      threads: globalThis.crossOriginIsolated ? 4 : 1,
    })
    const parts: string[] = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a.startsWith('-') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const v = args[i + 1]
        parts.push(`${a} ${/[:,=]/.test(v) ? `'${v}'` : v}`)
        i++
      } else {
        parts.push(a)
      }
    }
    return parts.join(' \\\n  ')
  })
</script>

<style scoped>
.cmd-block {
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  background: rgba(127, 127, 127, 0.12);
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
</style>

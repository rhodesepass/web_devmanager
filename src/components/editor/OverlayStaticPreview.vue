<template>
  <v-card class="pa-3 mt-4" variant="tonal">
    <div class="text-body-2 mb-2">叠加预览（固件排版近似复刻）</div>
    <div ref="containerRef" class="preview-box" />
  </v-card>
</template>

<script setup lang="ts">
  import Konva from 'konva'
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { ArknightsOverlayPreview } from './overlayPreview'

  const { project } = useEditorProject()
  const containerRef = ref<HTMLDivElement>()

  const STAGE_W = 200

  let stage: Konva.Stage | undefined
  let bgLayer: Konva.Layer | undefined
  let overlayLayer: Konva.Layer | undefined
  let preview: ArknightsOverlayPreview | undefined

  function layout () {
    if (!stage || !bgLayer) {
      return
    }
    const { width: cw, height: ch } = project.value.canvas
    const scale = STAGE_W / cw
    stage.size({ width: STAGE_W, height: Math.round(ch * scale) })
    stage.scale({ x: scale, y: scale })
    bgLayer.destroyChildren()
    bgLayer.add(new Konva.Rect({ x: 0, y: 0, width: cw, height: ch, fill: '#101010', listening: false }))
    stage.batchDraw()
  }

  function refresh () {
    if (!preview) {
      return
    }
    preview.setScale(project.value.canvas.width / 360)
    void preview.update(project.value.overlay, project.value.overlay.type !== 'none')
  }

  onMounted(() => {
    stage = new Konva.Stage({ container: containerRef.value!, width: STAGE_W, height: 10 })
    bgLayer = new Konva.Layer({ listening: false })
    overlayLayer = new Konva.Layer({ listening: false })
    stage.add(bgLayer, overlayLayer)
    preview = new ArknightsOverlayPreview(overlayLayer)
    layout()
    refresh()
  })

  onBeforeUnmount(() => {
    preview?.destroy()
    stage?.destroy()
  })

  watch(
    () => [JSON.stringify(project.value.overlay), project.value.canvas.width] as const,
    () => {
      layout()
      refresh()
    },
  )
</script>

<style scoped>
.preview-box {
  display: flex;
  justify-content: center;
}
</style>

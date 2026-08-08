<template>
  <div v-if="visible" class="splash-root" :class="{ 'splash-root--fade': fading }">
    <div class="splash-panel" :class="{ 'splash-panel--in': slidIn }">
      <div class="splash-center">
        <div class="splash-title">PRTS</div>
        <div class="splash-rule" />
        <div class="splash-sub">干员信息录入程序</div>
      </div>

      <div class="splash-foot">
        <span class="copyleft">©</span> ada closure church 1097
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref } from 'vue'
  import '@fontsource/bebas-neue'

  const emit = defineEmits<{ done: [] }>()

  const visible = ref(true)
  const slidIn = ref(false)
  const fading = ref(false)

  const SLIDE_MS = 450
  const HOLD_MS = 1100
  const FADE_MS = 500

  const timers: ReturnType<typeof setTimeout>[] = []

  onMounted(() => {
    // 下一帧再置位，保证初始 translateY(100%) 先渲染出来，过渡才会播
    requestAnimationFrame(() => {
      slidIn.value = true
    })
    timers.push(
      setTimeout(() => {
        fading.value = true
      }, SLIDE_MS + HOLD_MS),
      setTimeout(() => {
        visible.value = false
        emit('done')
      }, SLIDE_MS + HOLD_MS + FADE_MS),
    )
  })

  onBeforeUnmount(() => {
    for (const t of timers) {
      clearTimeout(t)
    }
  })
</script>

<style scoped>
.splash-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  opacity: 1;
  transition: opacity 0.5s ease;
}

.splash-root--fade {
  opacity: 0;
  pointer-events: none;
}

.splash-panel {
  position: absolute;
  inset: 0;
  background: #0d0d0d;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transform: translateY(100%);
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.splash-panel--in {
  transform: translateY(0);
}

.splash-center {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.splash-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: min(22vw, 180px);
  line-height: 1;
  letter-spacing: 0.12em;
  color: #f0f0f0;
  user-select: none;
}

.splash-rule {
  width: min(46vw, 380px);
  height: 2px;
  margin: 8px 0 14px;
  background: linear-gradient(90deg, transparent, #ffd800 20%, #ffd800 80%, transparent);
}

.splash-sub {
  font-size: 15px;
  letter-spacing: 0.6em;
  text-indent: 0.6em;
  color: rgba(240, 240, 240, 0.75);
  user-select: none;
}

.splash-foot {
  position: absolute;
  bottom: 28px;
  font-family: monospace;
  font-size: 12px;
  letter-spacing: 0.15em;
  color: rgba(240, 240, 240, 0.4);
  user-select: none;
}

/* copyleft：反着的 © */
.copyleft {
  display: inline-block;
  transform: scaleX(-1);
}
</style>

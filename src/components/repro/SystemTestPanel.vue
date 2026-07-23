<template>
  <v-alert
    class="mb-4"
    density="comfortable"
    icon="mdi-power"
    type="info"
    variant="tonal"
  >
    <div class="text-body-2">
      <strong>进入 FEL 模式：</strong>拔出 SD 卡，关闭板子电源，按住 FEL 按钮（从上往下第五个按钮），再按住电源键（最下面的按钮）上电。
    </div>
    <div class="text-body-2 mt-1">
      如果点击「连接 FEL」没有反应，请先
      <a class="text-decoration-underline" href="#" @click.prevent="openPlatformNotice()">重新安装驱动</a>，
      仍然不行则检查 USB 链路是否虚焊，可用
      <a :href="siteLinks.usbTreeView" rel="noopener noreferrer" target="_blank">UsbTreeView</a>
      观察设备是否被系统枚举。
    </div>
  </v-alert>

  <v-card class="mb-4" variant="outlined">
    <v-card-text>
      <v-row dense>
        <v-col cols="12" sm="4">
          <v-select
            v-model="selectedRev"
            density="compact"
            :disabled="connected"
            hide-details
            :items="revisions"
            label="硬件版本"
            variant="outlined"
          />
        </v-col>

        <v-col class="d-flex align-center ga-2" cols="12" sm="8">
          <v-btn
            v-if="!connected"
            color="primary"
            :disabled="!isSupported"
            :loading="connecting"
            prepend-icon="mdi-usb"
            @click="connect"
          >
            连接 FEL
          </v-btn>

          <template v-else>
            <v-btn
              color="primary"
              :loading="autoRunning"
              prepend-icon="mdi-play"
              @click="runAutoTest"
            >
              开始自动测试
            </v-btn>

            <v-btn
              color="error"
              :disabled="autoRunning"
              prepend-icon="mdi-usb-port"
              variant="tonal"
              @click="disconnect"
            >
              断开
            </v-btn>
          </template>
        </v-col>
      </v-row>

      <v-list class="border rounded mt-4" density="compact" lines="two">
        <v-list-item v-for="stage in stages" :key="stage.key">
          <template #prepend>
            <v-progress-circular
              v-if="stage.status === 'running'"
              color="primary"
              indeterminate
              size="24"
              width="2"
            />
            <v-icon
              v-else
              :color="stageColor(stage.status)"
              :icon="stageIcon(stage.status)"
            />
          </template>

          <v-list-item-title>{{ stage.title }}</v-list-item-title>
          <v-list-item-subtitle v-if="stage.detail">{{ stage.detail }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>

      <v-alert
        v-if="summary"
        class="mt-4"
        density="comfortable"
        type="success"
        variant="tonal"
      >
        检测结果：{{ summary }}
      </v-alert>
    </v-card-text>
  </v-card>

  <v-row>
    <v-col cols="12" lg="5">
      <v-card variant="outlined">
        <v-card-text>
          <p class="text-body-2 font-weight-medium mb-1">手动引脚测试（排查虚焊）</p>
          <p class="text-body-2 text-medium-emphasis mb-2">
            选择一个引脚开始测试（一次只驱动一个引脚）：
          </p>

          <v-list
            class="border rounded"
            density="compact"
            :disabled="!connected || autoRunning"
          >
            <v-list-item
              v-for="pin in pins"
              :key="pin.key"
              :active="activePin?.key === pin.key"
              @click="selectPin(pin)"
            >
              <v-list-item-title>
                {{ pin.signal }}
                <span class="text-medium-emphasis">（{{ pin.pinName }}）</span>
              </v-list-item-title>

              <template #append>
                <v-icon
                  v-if="activePin?.key === pin.key"
                  color="primary"
                  icon="mdi-flash"
                  size="small"
                />
              </template>
            </v-list-item>
          </v-list>

          <v-btn
            block
            class="mt-2"
            :disabled="!activePin"
            prepend-icon="mdi-stop"
            variant="tonal"
            @click="stopTest"
          >
            停止
          </v-btn>

          <v-divider class="my-4" />

          <p class="text-body-2 font-weight-medium mb-2">按键测试（LRADC）</p>

          <v-btn
            block
            :color="lradcActive ? 'error' : 'primary'"
            :disabled="!connected || autoRunning"
            :prepend-icon="lradcActive ? 'mdi-stop' : 'mdi-gesture-tap-button'"
            variant="tonal"
            @click="lradcActive ? stopLradcTest() : startLradcTest()"
          >
            {{ lradcActive ? '停止按键测试' : '开始按键测试' }}
          </v-btn>

          <template v-if="lradcActive">
            <v-row class="mt-1" dense>
              <v-col cols="4">
                <div class="text-caption text-medium-emphasis">原始值</div>
                <div class="text-h6">{{ lradcRaw ?? '—' }}<span class="text-body-2 text-medium-emphasis">/63</span></div>
              </v-col>

              <v-col cols="4">
                <div class="text-caption text-medium-emphasis">电压</div>
                <div class="text-h6">{{ lradcVoltageUv == null ? '—' : (lradcVoltageUv / 1_000_000).toFixed(2) + ' V' }}</div>
              </v-col>

              <v-col cols="4">
                <div class="text-caption text-medium-emphasis">识别按键</div>
                <div class="text-h6" :class="lradcKeyLabel ? 'text-success' : 'text-medium-emphasis'">
                  {{ lradcKeyLabel ?? '无' }}
                </div>
              </v-col>
            </v-row>

            <p class="text-caption text-medium-emphasis mb-0">
              请逐个按住面板按键，确认每个键都能被识别：
              {{ lradcKeys.map(k => k.label).join('、') }}
            </p>
          </template>

          <template v-if="supportsPoweroff">
            <v-divider class="my-4" />

            <p class="text-body-2 font-weight-medium mb-2">断电测试（gpio-shutdown）</p>

            <p class="text-caption text-medium-emphasis mb-2">
              点击后会拉高 PE2 主动切断板子电源：屏幕熄灭、USB 断开即为正常；若板子几秒后仍然在线，说明关机电路虚焊或元件缺失。测试完请重新进入 FEL 模式再连接。
            </p>

            <v-btn
              block
              color="error"
              :disabled="!connected || autoRunning"
              :loading="poweroffPending"
              prepend-icon="mdi-power-plug-off"
              variant="tonal"
              @click="triggerPoweroff"
            >
              触发断电
            </v-btn>
          </template>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="7">
      <v-card variant="outlined">
        <v-card-text>
          <v-alert
            class="mb-4"
            :type="activePin ? 'info' : undefined"
            variant="tonal"
          >
            {{ guidance }}
          </v-alert>

          <template v-if="activePin">
            <v-row class="mb-2" dense>
              <v-col cols="6" sm="4">
                <div class="text-caption text-medium-emphasis">当前引脚</div>
                <div class="text-h6">{{ activePin.signal }} <span class="text-body-2 text-medium-emphasis">{{ activePin.pinName }}</span></div>
              </v-col>

              <v-col cols="6" sm="4">
                <div class="text-caption text-medium-emphasis">设定电平</div>

                <div class="text-h6" :class="expected ? 'text-success' : 'text-medium-emphasis'">
                  {{ expected ? '高 3.3V' : '低 0V' }}
                </div>
              </v-col>

              <v-col cols="6" sm="4">
                <div class="text-caption text-medium-emphasis">翻转次数</div>
                <div class="text-h6">{{ toggleCount }}</div>
              </v-col>
            </v-row>
          </template>

          <div class="solder-log pa-3 rounded bg-surface-variant">
            <div
              v-for="(line, index) in logs"
              :key="index"
              class="text-caption font-mono"
            >
              {{ line }}
            </div>

            <p
              v-if="logs.length === 0"
              class="text-caption text-medium-emphasis mb-0"
            >
              暂无日志
            </p>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import type { StageStatus } from '@/composables/useSystemTest'
  import { computed, onBeforeUnmount, watch } from 'vue'
  import { usePlatformNotice } from '@/composables/usePlatformNotice'
  import { useSystemTest } from '@/composables/useSystemTest'
  import { siteLinks } from '@/config/site'

  const revisions = ['0.1', '0.2', '0.3', '0.5', '0.6']

  const { open: openPlatformNotice } = usePlatformNotice(true)

  const {
    isSupported,
    connected,
    connecting,
    logs,
    selectedRev,
    pins,
    stages,
    autoRunning,
    summary,
    activePin,
    expected,
    toggleCount,
    lradcActive,
    lradcRaw,
    lradcVoltageUv,
    lradcKeyLabel,
    lradcKeys,
    supportsPoweroff,
    poweroffPending,
    connect,
    runAutoTest,
    selectPin,
    stopTest,
    startLradcTest,
    stopLradcTest,
    triggerPoweroff,
    disconnect,
  } = useSystemTest()

  function stageIcon (status: StageStatus): string {
    switch (status) {
      case 'pass': { return 'mdi-check-circle' }
      case 'warn': { return 'mdi-alert-circle' }
      case 'fail': { return 'mdi-close-circle' }
      default: { return 'mdi-circle-outline' }
    }
  }

  function stageColor (status: StageStatus): string | undefined {
    switch (status) {
      case 'pass': { return 'success' }
      case 'warn': { return 'warning' }
      case 'fail': { return 'error' }
      default: { return undefined }
    }
  }

  const guidance = computed(() => {
    if (!connected.value) {
      return '请先让板子进入 FEL 模式，然后点击「连接 FEL」授权。连接后建议先跑一遍自动测试。'
    }
    if (lradcActive.value) {
      return '正在轮询 LRADC。请逐个按住面板按键，右侧「识别按键」应显示对应键名；某个键按下无反应或识别错误，说明该键或分压电阻虚焊 / 焊错阻值。'
    }
    const p = activePin.value
    if (!p) {
      return '已连接。上方可一键自动测试芯片 / NAND / DDR；左侧可手动逐脚驱动方波排查虚焊，或用 LRADC 按键测试检查实体按键。'
    }
    if (p.key === 'pwm0') {
      return `正在以 0.25Hz 驱动 ${p.signal}（${p.pinName}）。请插上屏幕，应看到背光每 2 秒闪烁一次。若背光不闪，该脚可能虚焊。`
    }
    const lv = expected.value ? '高（3.3V）' : '低（0V）'
    return `正在以 0.25Hz 驱动 ${p.signal}（${p.pinName}），当前输出 ${lv}。用万用表直流电压档，黑表笔接地、红表笔点 ${p.signal} 测试点，应看到读数每 2 秒在 0V↔3.3V 之间跳动。若读数不跳变或对不上，该脚可能虚焊。`
  })

  watch(selectedRev, () => {
    stopTest()
  })

  onBeforeUnmount(() => {
    if (connected.value) {
      disconnect()
    }
  })

  defineExpose({ connected, disconnect })
</script>

<style scoped>
  .solder-log {
    min-height: 120px;
    max-height: 320px;
    overflow-y: auto;
  }
</style>

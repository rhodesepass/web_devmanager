<template>
  <div>
    <PageHeader
      subtitle="从工具准备、PCB / 元件下单到焊接与系统测试的交互式复刻清单，进度会自动保存"
      title="复刻向导"
    />

    <BrowserWarning v-if="!isSupported" class="mb-4" />

    <v-card>
      <v-card-text>
        <div class="d-flex align-center mb-2">
          <div class="text-body-2 text-medium-emphasis">
            共 {{ steps.length }} 步 · 已完成 {{ doneCount }} 步
          </div>

          <v-spacer />

          <v-btn
            density="comfortable"
            prepend-icon="mdi-restore"
            size="small"
            variant="text"
            @click="onReset"
          >
            重置进度
          </v-btn>
        </div>

        <div class="repro-stepper">
          <div
            v-for="(step, index) in steps"
            :key="step.key"
            class="repro-step"
            :class="{ 'repro-step--last': index === steps.length - 1 }"
          >
            <div class="repro-step__rail">
              <v-avatar
                :color="stepColor(step.key, index)"
                size="32"
                :variant="index === currentStep ? 'flat' : 'tonal'"
              >
                <v-icon v-if="stepDone(step.key)" icon="mdi-check" size="small" />
                <span v-else class="text-body-2">{{ index + 1 }}</span>
              </v-avatar>

              <div v-if="index !== steps.length - 1" class="repro-step__line" />
            </div>

            <div class="repro-step__body">
              <button
                class="repro-step__header"
                type="button"
                @click="toggleStep(index)"
              >
                <div>
                  <div class="text-subtitle-1 font-weight-medium">
                    {{ step.title }}
                  </div>
                  <div class="text-caption text-medium-emphasis">
                    {{ step.subtitle }}
                  </div>
                </div>

                <v-spacer />

                <v-chip
                  v-if="stepProgress(step.key).total > 0"
                  class="mr-2"
                  :color="stepDone(step.key) ? 'success' : undefined"
                  size="small"
                  variant="tonal"
                >
                  {{ stepProgress(step.key).done }} / {{ stepProgress(step.key).total }}
                </v-chip>

                <v-icon
                  :icon="currentStep === index ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                />
              </button>

              <v-expand-transition>
                <div v-show="currentStep === index" class="repro-step__content pt-2 pb-4">
                  <!-- 1. 工具准备 -->
                  <template v-if="step.key === 'tools'">
                    <p class="text-body-2 font-weight-medium mb-1">工具器材</p>
                    <ChecklistGroup
                      :is-checked="isChecked"
                      :items="tools"
                      @toggle="toggle"
                    />

                    <p class="text-body-2 font-weight-medium mt-4 mb-1">需下载的文件</p>
                    <ChecklistGroup
                      :is-checked="isChecked"
                      :items="files"
                      @toggle="toggle"
                    />
                  </template>

                  <!-- 2. PCB 下单 -->
                  <template v-else-if="step.key === 'pcb'">
                    <p class="text-body-2 text-medium-emphasis mb-2">
                      新版硬件是嘉立创（立创）EDA 工程，直接在 EDA 里一键下单，<strong>不需要导出 Gerber 上传</strong>。
                    </p>

                    <v-alert
                      class="mb-3"
                      density="comfortable"
                      icon="mdi-book-open-page-variant-outline"
                      type="info"
                      variant="tonal"
                    >
                      <div class="text-body-2">
                        第一次下单看不懂？这里有一篇<strong>超详细的图文手把手教程</strong>，从注册到付款全程截图。
                      </div>
                      <template #append>
                        <v-btn
                          :href="links.pcbOrderGuide"
                          color="info"
                          rel="noopener"
                          size="small"
                          target="_blank"
                          variant="flat"
                        >
                          手把手下单教程
                        </v-btn>
                      </template>
                    </v-alert>

                    <ChecklistGroup
                      :is-checked="isChecked"
                      :items="pcbSteps"
                      ordered
                      @toggle="toggle"
                    />

                    <v-alert
                      class="mt-3"
                      density="comfortable"
                      icon="mdi-alert-circle-outline"
                      type="warning"
                      variant="tonal"
                    >
                      <div class="text-body-2 font-weight-medium mb-1">关键注意事项</div>
                      <ul class="repro-notes">
                        <li v-for="(note, i) in pcbNotes" :key="i">{{ note }}</li>
                      </ul>
                    </v-alert>
                  </template>

                  <!-- 3. 元件下单 -->
                  <template v-else-if="step.key === 'bom'">
                    <div class="d-flex align-center flex-wrap ga-2 mb-2">
                      <span class="text-body-2 text-medium-emphasis">阻容封装版本：</span>
                      <v-btn-toggle
                        v-model="bomVersion"
                        color="primary"
                        density="compact"
                        mandatory
                        variant="outlined"
                      >
                        <v-btn
                          v-for="v in bomVersions"
                          :key="v"
                          size="small"
                          :value="v"
                        >
                          {{ v }}{{ v === '0603' ? '（推荐）' : '' }}
                        </v-btn>
                      </v-btn-toggle>
                    </div>

                    <div class="d-flex align-center flex-wrap ga-2 mb-2">
                      <span class="text-body-2 text-medium-emphasis">屏幕型号：</span>
                      <v-btn-toggle
                        v-model="screen"
                        color="primary"
                        density="compact"
                        mandatory
                        variant="outlined"
                      >
                        <v-btn
                          v-for="s in screens"
                          :key="s.value"
                          size="small"
                          :value="s.value"
                        >
                          {{ s.label }}
                        </v-btn>
                      </v-btn-toggle>
                    </div>

                    <v-alert
                      class="mb-3"
                      density="comfortable"
                      icon="mdi-monitor"
                      type="info"
                      variant="tonal"
                    >
                      <div class="text-body-2 font-weight-medium mb-1">屏幕怎么选 / 怎么买</div>
                      <ul class="repro-notes">
                        <li v-for="s in screenBuy" :key="s.name">
                          <strong>{{ s.name }}</strong>：{{ s.hint }}
                        </li>
                      </ul>
                    </v-alert>

                    <p class="text-body-2 text-medium-emphasis mb-2">
                      按你要焊的 PCB 版本选封装、按买到的屏幕选型号，照下表采购；
                      {{ screen === 'hsd' ? 'HSD / BOE 屏用上接口 FPC2' : '老五屏用下接口 FPC1' }}。
                      完整清单以 Release 里的
                      <a :href="links.release" rel="noopener" target="_blank">交互式 BOM</a> 为准;
                      每个料的淘宝购买链接见
                      <a :href="links.bomOnline" rel="noopener" target="_blank">在线 BOM(腾讯文档)</a>。
                      如果你想偷懒，可以直接在群里大喊“谁有卖套件包”。
                    </p>

                    <div
                      v-for="group in bom"
                      :key="group.id"
                      class="mb-4"
                    >
                      <div class="d-flex align-center mb-1">
                        <span
                          class="repro-bom__dot"
                          :style="{ backgroundColor: group.color }"
                        />
                        <span class="text-body-2 font-weight-medium">{{ group.name }}</span>
                      </div>

                      <v-table class="repro-bom__table border rounded" density="compact">
                        <thead>
                          <tr>
                            <th class="repro-bom__check" />
                            <th>位号</th>
                            <th>型号</th>
                            <th>封装</th>
                            <th class="text-right">数量</th>
                            <th>备注</th>
                          </tr>
                        </thead>
                        <tbody>
                          <template
                            v-for="entry in visibleItems(group)"
                            :key="entry.reference"
                          >
                            <tr
                              class="repro-bom__row"
                              :class="{ 'repro-bom__row--done': isChecked('bom:' + entry.reference) }"
                            >
                              <td class="repro-bom__check">
                                <v-checkbox
                                  density="compact"
                                  hide-details
                                  :model-value="isChecked('bom:' + entry.reference)"
                                  @update:model-value="toggle('bom:' + entry.reference, !!$event)"
                                />
                              </td>
                              <td class="font-mono text-no-wrap">{{ entry.reference }}</td>
                              <td class="font-mono text-no-wrap">{{ entry.value }}</td>
                              <td class="text-no-wrap">{{ entry.footprint }}</td>
                              <td class="text-right">{{ entry.quantity }}</td>
                              <td>
                                <div>{{ entry.description }}</div>
                                <div v-if="entry.optionalNote" class="text-caption text-medium-emphasis">
                                  可选 · {{ entry.optionalNote }}
                                </div>
                                <button
                                  v-if="entry.alternatives"
                                  class="repro-bom__alt-toggle"
                                  type="button"
                                  @click="toggleAlt(entry.reference)"
                                >
                                  {{ entry.altLabel || (entry.alternatives.length + ' 个 pin2pin 替代') }}
                                  <v-icon
                                    :icon="altExpanded.has(entry.reference) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                                    size="x-small"
                                  />
                                </button>
                              </td>
                            </tr>

                            <tr
                              v-if="entry.alternatives && altExpanded.has(entry.reference)"
                              class="repro-bom__alt-row"
                            >
                              <td :colspan="6">
                                <div v-if="entry.altTitle" class="text-caption text-medium-emphasis mb-1">
                                  {{ entry.altTitle }}
                                </div>
                                <div
                                  v-for="alt in entry.alternatives"
                                  :key="alt.value"
                                  class="repro-bom__alt-item"
                                >
                                  <span class="font-mono">{{ alt.value }}</span>
                                  <span v-if="alt.note" class="text-caption text-medium-emphasis ml-2">{{ alt.note }}</span>
                                </div>
                              </td>
                            </tr>
                          </template>
                        </tbody>
                      </v-table>
                    </div>

                    <v-checkbox
                      color="primary"
                      density="compact"
                      hide-details
                      label="已购买屏幕"
                      :model-value="isChecked('screen-bought')"
                      @update:model-value="toggle('screen-bought', !!$event)"
                    />
                    <v-checkbox
                      color="primary"
                      density="compact"
                      hide-details
                      label="已按 BOM 下单元件"
                      :model-value="isChecked('bom-ordered')"
                      @update:model-value="toggle('bom-ordered', !!$event)"
                    />
                  </template>

                  <!-- 4. 外壳与面板 -->
                  <template v-else-if="step.key === 'case'">
                    <p class="text-body-2 text-medium-emphasis mb-2">
                      外壳走 CNC 加工,亚克力面板/保护板按图纸文件定制,配套螺丝螺柱照下表采购。
                    </p>
                    <ChecklistGroup
                      :is-checked="isChecked"
                      :items="caseItems"
                      @toggle="toggle"
                    />

                    <v-alert
                      class="mt-3 mb-3"
                      density="comfortable"
                      icon="mdi-alert-circle-outline"
                      type="warning"
                      variant="tonal"
                    >
                      <div class="text-body-2 font-weight-medium mb-1">下单前必读</div>
                      <ul class="repro-notes">
                        <li v-for="(note, i) in caseNotes" :key="i">{{ note }}</li>
                      </ul>
                    </v-alert>

                    <p class="text-body-2 font-weight-medium mb-1">外壳配件清单</p>
                    <v-table class="repro-bom__table border rounded" density="compact">
                      <thead>
                        <tr>
                          <th>零件</th>
                          <th>规格</th>
                          <th>说明</th>
                          <th class="text-right">购买</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="item in caseBom" :key="item.part">
                          <td class="text-no-wrap">
                            {{ item.part }}
                            <span v-if="item.optional" class="text-caption text-medium-emphasis">(可选)</span>
                          </td>
                          <td>{{ item.spec || '—' }}</td>
                          <td>{{ item.note }}</td>
                          <td class="text-right text-no-wrap">
                            <template v-if="item.links">
                              <template v-for="(l, li) in item.links" :key="l.url">
                                <a :href="l.url" rel="noopener" target="_blank">{{ l.text }}</a>
                                <span v-if="li < item.links.length - 1"> / </span>
                              </template>
                            </template>
                            <a v-else-if="item.link" :href="item.link" rel="noopener" target="_blank">链接</a>
                            <span v-else class="text-medium-emphasis">—</span>
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </template>

                  <!-- 5. 焊接贴装 -->
                  <template v-else-if="step.key === 'solder'">
                    <v-alert
                      class="mb-3"
                      density="comfortable"
                      icon="mdi-information-outline"
                      type="info"
                      variant="tonal"
                    >
                      <ul class="repro-notes">
                        <li v-for="(note, i) in assemblyNotes" :key="i">{{ note }}</li>
                      </ul>
                      <div class="text-caption mt-2">
                        视频参考：
                        <a :href="links.videoSolder" rel="noopener" target="_blank">焊接教程</a> ·
                        <a :href="links.videoSolderHard" rel="noopener" target="_blank">焊接难点</a> ·
                        <a :href="links.videoAssembly" rel="noopener" target="_blank">焊接外壳特写合集</a>
                      </div>
                    </v-alert>

                    <p class="text-body-2 font-weight-medium mb-1">推荐焊接顺序</p>
                    <ol class="repro-solder-steps text-body-2 mb-2">
                      <li>先焊接除 F1C 主控和 NAND（Flash）以外的部分</li>
                      <li>用万用表导通挡确认 1.2V / 2.5V / 3.3V 三条电源轨<strong>两两之间及对地</strong>都不短路</li>
                      <li>上电测量三条电源轨电压正常（1.2V / 2.5V / 3.3V）</li>
                      <li>断电后焊接 F1C 和 NAND，焊完<strong>再次</strong>确认两两 / 对地不短路</li>
                      <li>连接电脑。如果 USB 设备未枚举，回来检查 USB 链路焊接是否正常、晶振有没有起振（用万用表测量晶振匹配电容两边电压）</li>
                    </ol>

                    <v-checkbox
                      class="mt-2"
                      color="primary"
                      density="compact"
                      hide-details
                      label="已完成焊接，短路检查与电压测量正常"
                      :model-value="isChecked('solder-done')"
                      @update:model-value="toggle('solder-done', !!$event)"
                    />
                  </template>

                  <!-- 6. 系统测试 -->
                  <template v-else-if="step.key === 'systest'">
                    <p class="text-body-2 text-medium-emphasis mb-2">
                      让板子进入 FEL 模式后，用下面的工具做整机系统测试：先一键自动检测芯片型号、SPI NAND 和 DDR，再按需逐脚驱动方波、配合万用表排查虚焊（实验性功能）：
                    </p>

                    <SystemTestPanel />

                    <v-checkbox
                      class="mt-2"
                      color="primary"
                      density="compact"
                      hide-details
                      label="已完成系统测试，自动检测通过"
                      :model-value="isChecked('systest-done')"
                      @update:model-value="toggle('systest-done', !!$event)"
                    />
                  </template>

                  <!-- 7. 下一步 -->
                  <template v-else-if="step.key === 'next'">
                    <p class="text-body-2 mb-2">
                      如果上一步的系统测试一切正常，恭喜！硬件部分已经完工。接下来前往
                      <RouterLink to="/flash">烧录页面</RouterLink>
                      向设备下载程序，进入系统后记得测试 SD 卡（数据盘）能否正常读写。
                    </p>

                    <v-btn
                      class="mb-4"
                      color="primary"
                      prepend-icon="mdi-flash"
                      to="/flash"
                      variant="tonal"
                    >
                      前往烧录
                    </v-btn>

                    <v-alert
                      density="comfortable"
                      icon="mdi-heart-outline"
                      type="success"
                      variant="tonal"
                    >
                      <div class="text-body-2">
                        感谢你复刻本项目！如有其他问题，欢迎到群里交流：
                        QQ 1群 {{ siteLinks.qqGroup1 }} · QQ 2群 {{ siteLinks.qqGroup2 }}
                      </div>
                    </v-alert>
                  </template>

                  <div class="d-flex ga-2 mt-4">
                    <v-btn
                      v-if="index < steps.length - 1"
                      color="primary"
                      variant="tonal"
                      @click="toggleStep(index + 1)"
                    >
                      下一步
                    </v-btn>
                    <v-btn
                      v-if="index > 0"
                      variant="text"
                      @click="toggleStep(index - 1)"
                    >
                      上一步
                    </v-btn>
                  </div>
                </div>
              </v-expand-transition>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, ref } from 'vue'
  import BrowserWarning from '@/components/BrowserWarning.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import ChecklistGroup from '@/components/repro/ChecklistGroup.vue'
  import SystemTestPanel from '@/components/repro/SystemTestPanel.vue'
  import type { BomGroup, ReproBomVersion, ReproScreen } from '@/config/reproGuide'
  import {
    ASSEMBLY_NOTES,
    PCB_ORDER_NOTES,
    PCB_ORDER_STEPS,
    REPRO_BOM_VERSIONS,
    REPRO_CASE,
    REPRO_CASE_BOM,
    REPRO_CASE_NOTES,
    REPRO_FILES,
    REPRO_SCREEN_BUY,
    REPRO_SCREENS,
    REPRO_TOOLS,
    reproBom,
    reproLinks,
  } from '@/config/reproGuide'
  import { useReproGuide } from '@/composables/useReproGuide'
  import { siteLinks } from '@/config/site'
  import { isWebUsbSupported } from '@/utils/browser'

  const isSupported = isWebUsbSupported()

  const tools = REPRO_TOOLS
  const files = REPRO_FILES
  const pcbSteps = PCB_ORDER_STEPS
  const pcbNotes = PCB_ORDER_NOTES
  const caseItems = REPRO_CASE
  const caseNotes = REPRO_CASE_NOTES
  const caseBom = REPRO_CASE_BOM
  const assemblyNotes = ASSEMBLY_NOTES
  const links = reproLinks

  const bomVersions = REPRO_BOM_VERSIONS
  const bomVersion = ref<ReproBomVersion>('0603')
  const bom = computed(() => reproBom(bomVersion.value))

  const screens = REPRO_SCREENS
  const screenBuy = REPRO_SCREEN_BUY
  const screen = ref<ReproScreen>('hsd')

  const altExpanded = ref<Set<string>>(new Set())
  function toggleAlt (refId: string) {
    const next = new Set(altExpanded.value)
    if (next.has(refId)) {
      next.delete(refId)
    } else {
      next.add(refId)
    }
    altExpanded.value = next
  }

  function visibleItems (group: BomGroup) {
    return group.items.filter(e => !e.screen || e.screen === screen.value)
  }

  const steps = [
    { key: 'tools', title: '工具准备', subtitle: '备齐焊接/调试工具，下载工程与固件' },
    { key: 'pcb', title: 'PCB 下单', subtitle: '立创 EDA 打开工程，一键下单打样' },
    { key: 'bom', title: '元件下单', subtitle: '照 BOM 采购全部元器件' },
    { key: 'case', title: '外壳与面板', subtitle: '照图纸下单外壳 / 面板 / 保护板' },
    { key: 'solder', title: '焊接贴装', subtitle: '分批焊接,焊前焊后做短路检查与电压测量' },
    { key: 'systest', title: '系统测试', subtitle: '用 FEL 自动检测芯片 / NAND / DDR 并排查虚焊' },
    { key: 'next', title: '下一步', subtitle: '烧录固件,点亮你的通行证' },
  ] as const

  const {
    currentStep,
    isChecked,
    toggle,
    stepDone,
    stepProgress,
    reset,
  } = useReproGuide()

  const doneCount = computed(() => steps.filter(s => stepDone(s.key)).length)

  function toggleStep (index: number) {
    currentStep.value = currentStep.value === index ? -1 : index
  }

  function stepColor (key: string, index: number): string {
    if (stepDone(key)) {
      return 'success'
    }
    return index === currentStep.value ? 'primary' : 'grey'
  }

  function onReset () {
    reset()
  }
</script>

<style scoped>
.repro-stepper {
  display: flex;
  flex-direction: column;
}

.repro-step {
  display: flex;
  gap: 16px;
}

.repro-step__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 32px;
}

.repro-step__line {
  flex: 1 1 auto;
  width: 2px;
  min-height: 12px;
  margin: 4px 0;
  background: rgba(var(--v-border-color), var(--v-border-opacity));
}

.repro-step__body {
  flex: 1 1 auto;
  min-width: 0;
  padding-bottom: 8px;
}

.repro-step--last .repro-step__body {
  padding-bottom: 0;
}

.repro-step__header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 4px 0;
  text-align: left;
  cursor: pointer;
}

.repro-step__content {
  overflow-x: auto;
}

.repro-notes {
  margin: 0;
  padding-left: 18px;
}

.repro-notes li {
  font-size: 0.8125rem;
  line-height: 1.5;
}

.repro-solder-steps {
  margin: 0;
  padding-left: 20px;
}

.repro-solder-steps li {
  margin-bottom: 6px;
  line-height: 1.6;
}

.repro-solder-steps li::marker {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.repro-bom__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
}

.repro-bom__table {
  width: 100%;
}

.repro-bom__check {
  width: 40px;
  padding-right: 0 !important;
}

.repro-bom__row--done {
  opacity: 0.55;
}

.repro-bom__alt-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
  padding: 0;
  color: rgb(var(--v-theme-primary));
  font-size: 0.75rem;
  cursor: pointer;
}

.repro-bom__alt-row td {
  background: rgba(var(--v-theme-primary), 0.04);
  padding: 8px 12px !important;
}

.repro-bom__alt-item {
  padding: 2px 0;
}
</style>

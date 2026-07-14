<template>
  <div>
    <PageHeader
      subtitle="管理设备上的扩列图，上传前可裁剪为 9:16 竖屏"
      title="扩列图"
    />

    <v-alert v-if="!connected" class="mb-4" type="info" variant="tonal">
      请先连接设备以管理设备上的扩列图。
    </v-alert>

    <template v-if="connected">
      <div class="d-flex flex-wrap align-center ga-2 mb-4">
        <v-btn
          :disabled="transferring"
          :loading="loading"
          prepend-icon="mdi-refresh"
          variant="tonal"
          @click="refresh"
        >
          刷新
        </v-btn>

        <v-btn
          color="primary"
          :disabled="transferring"
          prepend-icon="mdi-upload"
          @click="showUploadDialog = true"
        >
          上传扩列图
        </v-btn>
      </div>

      <v-card
        v-if="transferring && transferProgress"
        class="mb-4 pa-4"
        variant="tonal"
      >
        <div class="text-body-2 mb-2">
          {{ transferProgress.isUpload ? '上传' : '下载' }}：{{ transferProgress.fileName }}
        </div>
        <v-progress-linear
          color="primary"
          height="8"
          :model-value="transferPercent"
          rounded
        />
        <div class="text-caption text-medium-emphasis mt-1">
          {{ formatBytes(transferProgress.bytes) }} / {{ formatBytes(transferProgress.total) }}
        </div>
      </v-card>

      <v-progress-linear
        v-if="loading"
        class="mb-4"
        color="primary"
        indeterminate
        rounded
      />

      <div
        v-if="!loading && images.length === 0"
        class="text-center text-medium-emphasis py-12"
      >
        设备上暂无扩列图，点击「上传扩列图」添加。
      </div>

      <v-row v-else>
        <v-col
          v-for="img in images"
          :key="img.name"
          cols="6"
          lg="2"
          md="3"
          sm="4"
        >
          <DispImgCard
            :disabled="transferring"
            :info="img"
            @delete="pendingDelete = $event"
            @download="onDownload"
            @preview="previewImg = $event"
            @visible="loadThumb"
          />
        </v-col>
      </v-row>

      <DispImgUploadDialog
        v-model="showUploadDialog"
        @confirm="onUploadConfirm"
      />

      <v-dialog
        :model-value="previewImg != null"
        max-width="420"
        @update:model-value="previewImg = null"
      >
        <v-card v-if="previewImg" :title="previewImg.name">
          <v-img :src="previewImg.thumbUrl ?? undefined" />
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="previewImg = null">关闭</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <ConfirmDialog
        v-model="showDeleteConfirm"
        :message="deleteMessage"
        title="删除扩列图"
        @confirm="onDeleteConfirm"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { DispImgInfo } from '@/types/dispimg'
  import { computed, ref, toRef, watch } from 'vue'
  import ConfirmDialog from '@/components/ConfirmDialog.vue'
  import DispImgCard from '@/components/DispImgCard.vue'
  import DispImgUploadDialog from '@/components/DispImgUploadDialog.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import { useDispImg } from '@/composables/useDispImg'
  import { useUsb } from '@/composables/useUsb'
  import { formatBytes } from '@/utils/format'

  const { connected, client } = useUsb()

  const {
    images,
    loading,
    transferring,
    transferProgress,
    refresh,
    loadThumb,
    upload,
    download,
    remove,
  } = useDispImg(toRef(client))

  const showUploadDialog = ref(false)
  const previewImg = ref<DispImgInfo | null>(null)
  const pendingDelete = ref<DispImgInfo | null>(null)

  const transferPercent = computed(() => {
    const p = transferProgress.value
    if (!p || p.total <= 0) return 0
    return Math.min(100, Math.round((p.bytes / p.total) * 100))
  })

  const showDeleteConfirm = computed({
    get: () => pendingDelete.value != null,
    set: (v: boolean) => {
      if (!v) pendingDelete.value = null
    },
  })

  const deleteMessage = computed(() =>
    pendingDelete.value
      ? `确定删除扩列图「${pendingDelete.value.name}」？此操作不可恢复。`
      : '',
  )

  watch(connected, isConnected => {
    if (isConnected) {
      refresh()
    }
  }, { immediate: true })

  async function onUploadConfirm (blob: Blob, name: string) {
    try {
      await upload(blob, name)
    } catch {
      // 错误已在 composable 中提示
    }
  }

  async function onDownload (info: DispImgInfo) {
    try {
      await download(info)
    } catch {
      // 错误已在 composable 中提示
    }
  }

  async function onDeleteConfirm () {
    const info = pendingDelete.value
    if (!info) return
    pendingDelete.value = null
    await remove(info)
  }
</script>

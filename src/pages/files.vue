<template>
  <div>
    <PageHeader
      title="文件浏览"
      subtitle="浏览、上传和管理设备上的文件"
    />

    <v-alert v-if="!connected" type="info" variant="tonal" class="mb-4">
      请先连接设备。
    </v-alert>

    <template v-else>
      <v-breadcrumbs :items="breadcrumbs" density="compact" class="mb-1 pa-0">
        <template #title="{ item }">
          <span
            class="cursor-pointer"
            :class="{ 'text-medium-emphasis': (item as any).path === currentPath }"
            @click="navigate((item as any).path)"
          >
            {{ item.title }}
          </span>
        </template>
      </v-breadcrumbs>

      <FileActions
        :current-path="currentPath"
        :selected="selected"
        :items="entries"
        :uploading="uploading"
        :upload-progress="uploadProgress"
        @go-up="goUp"
        @refresh="refresh"
        @upload="showUpload = true"
        @upload-folder="onUploadFolderClick"
        @download="onDownload"
        @delete="onDelete"
        @rename="showRename = true"
        @mkdir="showMkdir = true"
      />

      <input
        ref="folderInput"
        webkitdirectory
        class="d-none"
        type="file"
        @change="onFolderSelected"
      >

      <FileList
        :items="entries"
        :loading="loading"
        :selected="selected"
        @update:selected="selected = $event"
        @navigate="onNavigate"
      />

      <UploadDialog
        v-model="showUpload"
        :uploading="uploading"
        @upload="onUpload"
      />

      <RenameDialog
        v-model="showRename"
        title="重命名"
        label="新名称"
        :initial-value="selected[0]"
        @confirm="onRenameConfirm"
      />

      <RenameDialog
        v-model="showMkdir"
        title="新建文件夹"
        label="文件夹名称"
        @confirm="onMkdirConfirm"
      />

      <ConfirmDialog
        v-model="showDeleteConfirm"
        title="删除"
        :message="`确定删除 ${selected.length} 个项目？`"
        @confirm="onDeleteConfirm"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, toRef } from 'vue'
import { useUsb } from '@/composables/useUsb'
import { useFileBrowser } from '@/composables/useFileBrowser'
import FileList from '@/components/FileList.vue'
import FileActions from '@/components/FileActions.vue'
import UploadDialog from '@/components/UploadDialog.vue'
import RenameDialog from '@/components/RenameDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PageHeader from '@/components/PageHeader.vue'

const { connected, client } = useUsb()

const {
  currentPath,
  entries,
  loading,
  selected,
  breadcrumbs,
  uploadProgress,
  uploading,
  navigate,
  goUp,
  refresh,
  upload,
  uploadFolder,
  download,
  downloadFolder,
  deleteEntry,
  renameEntry,
  createDirectory,
} = useFileBrowser(toRef(client))

const showUpload = ref(false)
const showRename = ref(false)
const showMkdir = ref(false)
const showDeleteConfirm = ref(false)
const folderInput = ref<HTMLInputElement | null>(null)

function onNavigate (name: string) {
  navigate(currentPath.value === '.' ? name : `${currentPath.value}/${name}`)
}

async function onUpload (files: File[]) {
  for (const file of files) {
    await upload(file)
  }
  showUpload.value = false
}

function onDownload () {
  if (selected.value.length !== 1) return
  const name = selected.value[0]
  const entry = entries.value.find(e => e.name === name)
  if (entry?.isDir) {
    downloadFolder(name)
  } else {
    download(name)
  }
}

function onUploadFolderClick () {
  folderInput.value?.click()
}

async function onFolderSelected (event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (files.length > 0) {
    await uploadFolder(files)
  }
}

function onDelete () {
  showDeleteConfirm.value = true
}

async function onDeleteConfirm () {
  for (const name of selected.value) {
    await deleteEntry(name)
  }
  selected.value = []
}

async function onRenameConfirm (newName: string) {
  if (selected.value.length === 1) {
    await renameEntry(selected.value[0], newName)
    selected.value = []
  }
}

async function onMkdirConfirm (name: string) {
  await createDirectory(name, true)
}
</script>

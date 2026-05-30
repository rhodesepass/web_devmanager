<template>
  <div class="d-flex flex-column fill-height">
    <p class="text-body-2 text-medium-emphasis mb-4">
      浏览社区分享的通行证素材，无需连接设备即可预览与下载。
    </p>

    <v-btn
      color="secondary"
      variant="tonal"
      prepend-icon="mdi-earth"
      to="/materials/share"
      class="align-self-start"
    >
      打开在线素材库
    </v-btn>

    <p class="text-body-2 text-medium-emphasis mb-4">
      也可以通过素材编辑器自己制作喜爱的素材！
    </p>

    <v-btn
      color="secondary"
      variant="tonal"
      prepend-icon="mdi-file-edit"
      href="https://openlist.slstudio.top/%E7%99%BD%E9%93%B6%E7%9A%84%E9%80%9A%E8%A1%8C%E8%AF%81/ArknightsPassMaker_v2.2.0_Setup.exe"
      target="_blank"
      rel="noopener noreferrer"
      class="align-self-start"
    >
      下载素材编辑器
    </v-btn>


    <v-spacer />

    <div class="text-caption text-medium-emphasis">
      连接设备后，可将素材直接传入通行证。
    </div>
  </div>
</template>

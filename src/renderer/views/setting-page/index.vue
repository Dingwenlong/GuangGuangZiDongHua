<template>
  <div class="w-screen h-screen">
    <TitleBar />
    <div
      class="fixed top-40 w-full h-[calc(100%-40px)] p-20 pt-0"
    >
      <div class="h-full bg-white rounded-[10px]">
        <LoginAccount />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted } from "vue"
import TitleBar from "@renderer/components/layout/title-bar/title-bar.vue";
import LoginAccount from "./components/loginAccount.vue"

const { ipcRendererChannel } = window;

onMounted(() => {
  ipcRendererChannel.OpenDevTools.invoke();
})
</script>

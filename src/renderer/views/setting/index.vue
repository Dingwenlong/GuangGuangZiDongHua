<template>
  <LoginAccount />
</template>

<script lang="ts" setup>
import { onMounted } from "vue"
import LoginAccount from "./components/loginAccount.vue"

const { ipcRendererChannel } = window;

onMounted(() => {
  ipcRendererChannel.OpenDevTools.invoke();
})
</script>

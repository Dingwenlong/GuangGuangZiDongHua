<template>
  <div class="select-none w-screen h-screen overflow-hidden">
    <TitleBar />
    <div
      class="fixed top-40 border-t-2 border-[#a8bbce] w-full h-[calc(100%-40px)] overflow-auto p-20"
    >
      <div class="h-full bg-white rounded-[10px]">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
import TitleBar from "@renderer/components/layout/title-bar/title-bar.vue";
</script>

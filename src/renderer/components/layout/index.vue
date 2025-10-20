<template>
  <div class="w-screen h-screen flex flex-col">
    <TitleBar />
    <div
      class="flex-1 border-t-4 border-[#a8bbce] w-full p-20 overflow-hidden"
      style="border-style: ridge;"
    >
      <div class="h-full bg-white shadow-[0_0_4px_2px_azure] rounded-[10px] overflow-hidden">
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

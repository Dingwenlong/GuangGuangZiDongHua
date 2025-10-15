<template>
  <div class="select-none w-screen h-screen flex flex-col">
    <TitleBar />
    <div
      class="flex-1 border-t-2 border-[#a8bbce] w-full p-20 overflow-hidden"
    >
      <div class="h-full bg-white rounded-[10px] overflow-hidden">
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

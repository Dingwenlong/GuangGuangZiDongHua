<template>
  <div class="h-full flex flex-row justify-between">
    <div class="select-none min-w-200 h-full bg-gray-100 p-15 text-[14px]">
      <div class="space-y-10">
        <div
          v-for="(item, index) in menus"
          :key="index"
          class="flex items-center gap-2 p-8 rounded-lg cursor-pointer transition-all duration-200"
          :class="item.checked ? 'bg-black text-white' : 'hover:bg-gray-200'"
          @click="() => selectMenu(index)">
          <img
            :class="item.checked ? 'invert' : ''"
            :src="MoFang"
            width="18"
            height="15" />
          <span>{{ item.title }}</span>
        </div>
      </div>
    </div>
    <div class="w-full bg-white p-15">
      <div class="h-full" v-show="menus[0].checked">
        <S1 />
      </div>
      <div class="h-full" v-show="menus[1].checked">
        <S2 />
      </div>
      <div class="h-full" v-show="menus[2].checked || menus[3].checked">
        <S3S4 />
      </div>
      <div class="h-full" v-show="menus[4].checked">
        <S5 />
      </div>
      <div class="h-full" v-show="menus[5].checked">
        <S6 />
      </div>
      <div class="h-full" v-show="menus[6].checked">
        <S7 />
      </div>
      <div class="h-full" v-show="menus[7].checked">
        <!-- <S8 /> -->
      </div>
    </div>
    <div class="min-w-3/12 max-w-3/12 bg-gray-100">
      <LogPanel :logs="logData" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, onUnmounted } from 'vue';
import LogPanel from './components/log-panel.vue';
import S1 from './components/s1.vue';
import S2 from './components/s2.vue';
import S3S4 from './components/s3s4.vue';
import S5 from './components/s5.vue';
import S6 from './components/s6.vue';
import S7 from './components/s7.vue';
import S8 from './components/s8.vue';
import MoFang from '@renderer/assets/icons/webp/mo-fang.webp';

const { ipcRendererChannel } = window;

const logData = ref<any[]>([]);

onMounted(() => {
  ipcRendererChannel.LogUpdate.on((_, arg) => {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(now.getDate()).padStart(2, '0')} ${String(
      now.getHours()
    ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(
      now.getSeconds()
    ).padStart(2, '0')}`;
    logData.value.push({
      time: timeStr,
      message: arg.message,
      type: arg.type,
    });
    if (logData.value.length > 1000) {
      logData.value.shift();
    }
  });
});

onUnmounted(() => {
  ipcRendererChannel.LogUpdate.removeAllListeners();
});

interface MenuItem {
  title: string;
  checked: boolean;
}

const menus = ref<MenuItem[]>([
  { title: 'S1 - 素材合并', checked: true },
  { title: 'S2 - 开拍去水印', checked: false },
  { title: 'S3 - 视频拆分', checked: false },
  { title: 'S4 - 视频分镜 - 混剪', checked: false },
  { title: 'S5 - 配音加字幕', checked: false },
  { title: 'S6 - 高清放大', checked: false },
  { title: 'S7 - 视频分发', checked: false },
  { title: 'S8 - 光合发布', checked: false },
]);

const selectMenu = (index: number) => {
  menus.value.forEach((item, i) => {
    item.checked = index === i;
  });
};
</script>

<style scoped></style>

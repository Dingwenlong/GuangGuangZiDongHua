<template>
  <div class="h-full flex flex-row justify-between">
    <div class="select-none min-w-200 h-full bg-gray-100 p-15 text-[14px]">
      <div class="space-y-10">
        <div
          v-for="(item, index) in menus"
          :key="index"
          class="flex items-center gap-2 p-8 rounded-lg cursor-pointer transition-all duration-200"
          :class="item.checked ? 'bg-black text-white' : 'hover:bg-gray-200'"
          @click="selectMenu(item.id)">
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
      <S1 v-show="menus.find(x => x.id === 1)!.checked" />
      <S2 v-if="menus.find(x => x.id === 2)!.checked" />
      <S3 v-show="menus.find(x => x.id === 3)!.checked" />
      <S5 v-show="menus.find(x => x.id === 5)!.checked" />
      <S6 v-if="menus.find(x => x.id === 6)!.checked" />
    </div>
    <div class="min-w-3/12 max-w-3/12 bg-gray-100">
      <LogPanel :logs="logData" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, onUnmounted, computed } from 'vue';
import LogPanel from './components/log-panel.vue';
import S1 from './components/s1.vue';
import S2 from './components/s2.vue';
import S3 from './components/s3.vue';
import S5 from './components/s5.vue';
import S6 from './components/s6.vue';
import MoFang from '@renderer/assets/icons/webp/mo-fang.webp';

const { ipcRendererChannel } = window;
const logData = ref<any[]>([]);
const getMenuChecked = (id: number) =>
  computed(() => menus.value.find(x => x.id == id)?.checked ?? false);

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
    if (logData.value.length > 100) {
      logData.value.shift();
    }
  });
});

onUnmounted(() => {
  ipcRendererChannel.LogUpdate.removeAllListeners();
});

interface MenuItem {
  id: number;
  title: string;
  checked: boolean;
}

const menus = ref<MenuItem[]>([
  { id: 1, title: 'S1 - 素材合并', checked: false },
  { id: 2, title: 'S2 - 开拍去水印', checked: false },
  { id: 3, title: 'S3 - 视频分割 - 商品', checked: true },
  { id: 4, title: 'S4 - 视频分割 - 分镜', checked: true },
  { id: 5, title: 'S5 - 自动混剪', checked: false },
  { id: 6, title: 'S6 - 高清放大', checked: false },
  { id: 7, title: 'S7 - 光合发布', checked: false },
]);

const selectMenu = (id: number) => {
  menus.value.forEach(item => {
    item.checked = item.id === id;
  });
  if ([3, 4].includes(id)) {
    menus.value
      .filter(x => [3, 4].includes(x.id))
      .forEach(item => {
        item.checked = true;
      });
  }
};
</script>

<style scoped></style>

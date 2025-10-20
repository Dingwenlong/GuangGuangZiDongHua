<template>
    <div class="h-full flex flex-row justify-between">
      <div class="select-none min-w-200 h-full bg-gray-100 p-15 text-[14px]">
        <div class="space-y-10">
          <div
            v-for="(item, index) in menus"
            :key="index"
            class="flex items-center gap-2 p-8 rounded-lg cursor-pointer transition-all duration-200"
            :class="item.checked ? 'bg-black text-white' : 'hover:bg-gray-200'"
            @click="selectMenu(index)"
          >
            <img :class="item.checked ? 'invert' : ''" :src="MoFang" width="18" height="15" />
            <span>{{ item.title }}</span>
          </div>
        </div>
      </div>
      <div class="w-full bg-white p-15">
        <S1 v-if="menus[0].checked" />
        <S2 v-if="menus[1].checked" />
      </div>
      <div class="min-w-3/12 bg-gray-100">
        <LogPanel :logs="logData" />
      </div>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, onUnmounted } from 'vue';
import LogPanel from './components/log-panel.vue';
import S1 from './components/s1.vue';
import S2 from './components/s2.vue';
import MoFang from '@renderer/assets/icons/webp/mo-fang.webp';

interface MenuItem {
  title: string;
  checked: boolean;
}

const { ipcRendererChannel } = window

// 菜单数据
const menus = ref<MenuItem[]>([
  { title: "S1 - 素材合并", checked: true },
  { title: "S2 - 开拍去水印", checked: false },
  { title: "S3 - 视频分割 - 商品", checked: false },
  { title: "S4 - 视频分割 - 分镜", checked: false },
  { title: "S5 - 自动混剪", checked: false },
  { title: "S6 - 高清放大", checked: false },
  { title: "S7 - 光合发布", checked: false }
]);

const selectMenu = (index: number) => {
  menus.value.forEach((item, i) => {
    item.checked = i === index;
  });
}

const logData = ref<any[]>([]);

onMounted(() => {
  ipcRendererChannel.LogUpdate.on((_, arg) => {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    logData.value.push({
      time: timeStr,
      message: arg.message,
      type: arg.type
    });
    if (logData.value.length > 100) {
      logData.value.shift();
    }
  });
});

onUnmounted(() => {
  ipcRendererChannel.LogUpdate.removeAllListeners();
});
</script>

<style scoped>
</style>

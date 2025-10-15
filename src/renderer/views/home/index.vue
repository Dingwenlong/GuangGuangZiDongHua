<template>
    <div class="h-full flex flex-row justify-between">
      <div class="min-w-200 h-full bg-[#F5F6F7] p-15 text-[14px]">
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
      <div class="w-full bg-white">
        <S1 v-if="menus[0].checked" />
        <S2 v-if="menus[1].checked" />
      </div>
      <div class="min-w-3/12 bg-gray-100">
        <LogPanel :logs="logData" />
      </div>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import LogPanel from './components/log-panel.vue';
import S1 from './components/s1.vue';
import S2 from './components/s2.vue';
import MoFang from '@renderer/assets/icons/webp/mo-fang.webp';

interface MenuItem {
  title: string;
  checked: boolean;
}

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


// 日志数据
const logData = ref<any[]>([]);

// 模拟持续添加日志
onMounted(() => {
  // 初始日志
  logData.value = [
    { time: '2025-09-30 14:29:15', message: '加载配置文件', type: 'info' },
    { time: '2025-09-30 14:29:16', message: '检测驱动设置', type: 'info' },
    { time: '2025-09-30 14:29:17', message: '处理系统错误：C:\\Windows\\System32\\Temp出错', type: 'error' },
    { time: '2025-09-30 14:29:18', message: '清理缓存', type: 'info' },
    { time: '2025-09-30 14:29:19', message: '提示浏览器版本过低需更新', type: 'warning' },
    { time: '2025-09-30 14:29:20', message: '选择封面模式', type: 'info' },
    { time: '2025-09-30 14:29:21', message: '修复商品EPC', type: 'success' }
  ];

  // 模拟持续添加日志
  setInterval(() => {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const logTypes = ['info', 'warning', 'error', 'success'];
    const messages = [
      { text: '系统运行正常', type: 'info' },
      { text: '检测到新任务', type: 'info' },
      { text: '开始处理任务', type: 'info' },
      { text: '任务处理完成', type: 'success' },
      { text: '保存数据成功', type: 'success' },
      { text: '网络连接正常', type: 'info' },
      { text: '内存使用率过高', type: 'warning' },
      { text: '磁盘空间不足', type: 'error' }
    ];

    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    logData.value.push({
      time: timeStr,
      message: randomMessage.text,
      type: randomMessage.type
    });

    // 限制日志数量，避免内存占用过大
    if (logData.value.length > 100) {
      logData.value.shift();
    }
  }, 3000);
});
</script>

<style scoped>
</style>

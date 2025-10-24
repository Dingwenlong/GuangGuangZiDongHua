<template>
  <div class="h-full flex flex-col">
    <div
      class="flex justify-between items-center p-12 border-b border-gray-300">
      <p class="font-bold text-xl">日志</p>
      <button
        @click="toggleExpand"
        class="p-5 rounded-full hover:bg-gray-300 transition-colors cursor-pointer"
        :title="isExpanded ? '折叠日志' : '展开日志'">
        <img v-if="isExpanded" :src="LeftRetract" width="21" height="18" />
        <img v-else :src="RightRetract" width="21" height="18" />
      </button>
    </div>

    <!-- 日志内容区域 -->
    <div
      v-show="isExpanded"
      ref="logContainer"
      class="flex-1 overflow-auto p-6">
      <div v-if="logs.length === 0" class="text-gray-500 text-center py-4">
        暂无日志信息
      </div>
      <ul v-else class="space-y-6">
        <li
          v-for="(log, index) in logs"
          :key="index"
          class="p-2 bg-white rounded-md shadow-sm border border-gray-200 text-sm px-6 py-4">
          <div class="flex justify-between">
            <span class="font-medium text-gray-700">{{ log.time }}</span>
            <span
              class="px-8 py-2 rounded-full text-xs"
              :class="getLogTypeClass(log.type)">
              {{ log.type }}
            </span>
          </div>
          <div class="mt-1 text-gray-600 overflow-ellipsis overflow-hidden">
            {{ log.message }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, nextTick, VNodeRef } from 'vue';
import RightRetract from '@renderer/assets/icons/webp/right-retract.webp';
import LeftRetract from '@renderer/assets/icons/webp/left-retract.webp';

interface Log {
  time: string; // 日志时间，格式为 "YYYY-MM-DD HH:MM:SS"
  message: string; // 日志内容
  type: string; // 日志类型：'info' | 'warning' | 'error' | 'success'
}

// 定义组件属性
const props = withDefaults(defineProps<{ logs: Log[] }>(), {
  //logs: []
});

// 组件状态
const isExpanded = ref(true);
const logContainer = ref<VNodeRef | null>(null);

// 切换展开/折叠状态
const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

// 根据日志类型获取样式类
const getLogTypeClass = (type: string) => {
  switch (type) {
    case 'error':
      return 'bg-red-100 text-red-800';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800';
    case 'success':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-blue-100 text-blue-800';
  }
};

// 监听日志变化，自动滚动到底部
watch(
  () => props.logs,
  () => {
    nextTick(() => {
      if (logContainer.value && isExpanded.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }
    });
  },
  { deep: true }
);

// 监听展开状态变化，展开时滚动到底部
watch(isExpanded, newVal => {
  if (newVal) {
    nextTick(() => {
      if (logContainer.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }
    });
  }
});
</script>

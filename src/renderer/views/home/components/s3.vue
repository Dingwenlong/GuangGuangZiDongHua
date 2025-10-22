<template>
  <div
    class="w-full h-full grid overflow-auto"
    style="grid-template-rows: minmax(min-content, 120px) minmax(200px, 1fr)">
    <div class="mb-15 flex flex-row items-center flex-wrap gap-10">
      <span class="text-[#666666] text-[12px]"
        >S3/S4为自动工作流，不支持单独使用</span
      >
      <div
        class="w-2/12 h-32 text-[12px] text-gray-400 content-center text-center">
        商品素材数量
        <Input
          class="w-60! h-20! text-center"
          readonly
          v-model:value="s3.productMaterialNum" />
        个
      </div>
      <div
        class="w-2/12 h-32 text-[12px] text-gray-400 content-center text-center">
        分镜场景阈值
        <Input
          class="w-60! h-20! text-center"
          readonly
          v-model:value="s3.storyboardSceneThreshold" />
      </div>
      <div
        class="w-3/12 h-32 text-[12px] text-gray-400 content-center text-center whitespace-nowrap">
        分镜时长
        <Input
          class="w-60! h-20! text-center"
          readonly
          v-model:value="s3.storyboardDuration1" />
        -
        <Input
          class="w-60! h-20! text-center"
          readonly
          v-model:value="s3.storyboardDuration2" />
        秒
      </div>
      <div
        class="w-2/12 h-32 text-[12px] leading-35 text-gray-400 content-center text-right whitespace-nowrap">
        自动接续工作流{{ s3.autoHandOnWorkflow ? '开启' : '关闭' }}
        <Switch
          v-model:checked="s3.autoHandOnWorkflow"
          class="mt-[-3px]"
          size="small" />
      </div>
    </div>
    <div class="mb-15 h-full overflow-auto">
      <Table
        :columns="columns"
        :data-source="tableData"
        :pagination="false"
        size="small"
        :scroll="{
          scrollToFirstRowOnChange: true,
        }"
        bordered>
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'videoMaterial'">
            <p>
              {{ record.videoMaterial }}
            </p>
          </template>
          <template v-else-if="column.key === 'action'" class="text-center">
            <div class="flex flex-row gap-4">
              <Button
                type="text"
                @click="
                  openFolderHandler(
                    record.taskDirectory + '\\' + record.videoMaterial
                  )
                "
                >打开</Button
              >
              <Button
                type="text"
                @click="openFolderHandler(record.taskDirectory + '\\')"
                >打开文件夹</Button
              >
            </div>
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, reactive, watch, computed } from 'vue';
import {
  Switch,
  Input,
  Table,
  Button,
  type TableColumnType,
} from 'ant-design-vue';
import path from 'path-browserify';

const { shell, ipcRendererChannel } = window;

const workDir = '视频去字幕任务';
const s1 = reactive({
  taskDirectory: 'test',
});
const s3 = ref({
  productMaterialNum: 4,
  storyboardSceneThreshold: 0.3,
  storyboardDuration1: 4,
  storyboardDuration2: 6,
  autoHandOnWorkflow: true,
});
const tableData = ref<any>([]);
const monitorDirectory = computed(() =>
  path.join(s1.taskDirectory, workDir).replace(/\//g, '\\')
);

watch(s3.value, val => {
  ipcRendererChannel.UpdateWorkbenchData.invoke({
    stepNo: 's3',
    sData: { ...val },
  });
});

onMounted(() => {
  // 获取历史缓存
  ipcRendererChannel.GetWorkbenchData.invoke('s1').then(workbenchS1 => {
    s1.taskDirectory = workbenchS1.taskDirectory ?? '';
  });
  ipcRendererChannel.GetWorkbenchData.invoke('s3').then(workbenchS3 => {
    s3.value = { ...workbenchS3 };
  });

  // 绑定文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (_, arg: { root: string; structure: any[] }) => {
      if (arg.root === s1.taskDirectory) {
        const dir = arg.structure.find(x => x.name === workDir);
        tableData.value = dir.children
          .filter((file: any) => file.isVideo)
          .map((file: any) => {
            return {
              taskDirectory: monitorDirectory.value,
              videoMaterial: file.name,
            };
          });
      }
    }
  );
});
onUnmounted(() => {
  // 移除文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.removeAllListeners();
});

const columns: TableColumnType[] = [
  {
    title: '任务目录',
    dataIndex: 'taskDirectory',
    key: 'taskDirectory',
    width: '20%',
  },
  {
    title: '视频素材-分镜-S3/S4分镜',
    dataIndex: 'videoMaterial',
    key: 'videoMaterial',
    width: '60%',
  },
  {
    title: '操作',
    key: 'action',
    align: 'center',
    width: '20%',
  },
];

function openFolderHandler(dir: any) {
  shell.openPath(dir);
}
</script>

<template>
  <div class="w-full h-full grid overflow-auto" style="grid-template-rows: minmax(min-content, 120px) minmax(200px, 1fr)">
    <div class="mb-15 flex flex-row items-center flex-wrap gap-10">
      <div class="w-full flex justify-between flex-row items-center gap-10">
        <Input class="w-6/12!" readonly v-model:value="s1.taskDirectory" placeholder="点击选择任务监听目录文件夹" @click="selectDirectoryHandler" />
        <div class="w-3/12 h-32 text-[12px] text-gray-400 content-center text-center">
          商品素材时长
          <Input class="w-60! h-20! text-center" readonly v-model:value="s1.materialDuration" />
          秒
        </div>
        <div class="w-3/12 h-32 text-[12px] leading-35 text-gray-400 content-center text-right">
          自动持续检测{{s1.autoMonitoring ? '开启' : '关闭' }}
          <Switch v-model:checked="s1.autoMonitoring" size="small" />
        </div>
      </div>
      <div class="w-full flex flex-row justify-end gap-10">
        <Button type="primary" :disabled="!s1.taskDirectory" @click="batchCreationFolderHandler">批量创建商品文件夹</Button>
        <Button type="primary" @click="() => startOrStopTaskHandler(!videoMonitoringRunning)">{{ !videoMonitoringRunning ? '开始' : '结束' }}执行自动工作流任务</Button>
      </div>
    </div>
    <div class="mb-15 h-full overflow-auto">
      <Table
        :columns="columns"
        :data-source="data"
        :pagination="false"
        size="small"
        :scroll="{
          scrollToFirstRowOnChange: true
        }"
        bordered
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'videoMaterial'">
            <p
              v-for="(item, index) in record.videoMaterial"
              :key="index"
              style="margin: 4px 0"
            >
              {{ item }}
            </p>
          </template>
          <template v-else-if="column.key === 'action'" class="text-center">
            <Button type="primary"@click="openFolderHandler(s1.taskDirectory + '\\' + record.productDirectory)">打开文件夹</Button>
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted ,reactive, watch } from 'vue';
import {
  Switch,
  Input,
  Table,
  Button,
  type TableColumnType
} from 'ant-design-vue';
import Timer from '@renderer/utils/timer'
import { nanoid } from 'nanoid';

const { shell, ipcRendererChannel } = window

const s1 = reactive({
  taskDirectory: 'test',
  materialDuration: '20',
  autoMonitoring: false,
  intervalSeconds: 5
});

const data = ref<any>([]);
const videoMonitoringRunning = ref(false);

watch(s1, async (val, _) => {
  await ipcRendererChannel.UpdateWorkbenchData.invoke({ ...val } as any);
  // 监听视频
  // if(!val.autoMonitoring) {
  //   videoMonitoringRunning.value = false;
  //   ipcRendererChannel.StopMonitoringVideo.invoke();
  // }
  // 监听文件夹
  if(val.taskDirectory && !videoMonitoringRunning.value) {
    ipcRendererChannel.StartMonitoringDirectory.invoke(val.taskDirectory);
  }
});

onMounted(async () => {
  // 获取历史缓存
  const workbench = await ipcRendererChannel.GetWorkbenchData.invoke();
  s1.taskDirectory = workbench.taskDirectory ?? '';
  s1.autoMonitoring = workbench.autoMonitoring ?? true;
  Timer.interval(s1.intervalSeconds * 1000, () => {
    if(s1.autoMonitoring) {
      startOrStopTaskHandler();
    }
  });
  // 绑定文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.on((event, arg: { root: string, structure: any[]}) => {
    data.value = arg.structure
    .filter(dir => {
      const [first, ..._] = dir.name
      return dir.type === 'directory' && first === 'S'
    })
    .map(dir => {
      return {
        taskDirectory: s1.taskDirectory,
        productDirectory: dir.path.replace(s1.taskDirectory + '\\', ''),
        videoMaterial: dir.children
          .filter((file: any) => file.isVideo && file.type === 'file')
          .map((file: any) => file.name)
      };
    });
  });
})
onUnmounted(() => {
  // 移除文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.removeAllListeners();
})

function startOrStopTaskHandler(start = true) {
  if (start && s1.taskDirectory && !videoMonitoringRunning.value) {
    videoMonitoringRunning.value = true;
    ipcRendererChannel.StartMonitoringVideo.invoke(s1.taskDirectory);
  } else if (!start && videoMonitoringRunning.value) {
    videoMonitoringRunning.value = false;
    ipcRendererChannel.StopMonitoringVideo.invoke();
  }
}

const columns: TableColumnType[] = [
  {
    title: '任务目录',
    dataIndex: 'taskDirectory',
    key: 'taskDirectory',
    width: '20%',
  },
  {
    title: '商品目录',
    dataIndex: 'productDirectory',
    key: 'productDirectory',
    width: '30%',
  },
  {
    title: '视频素材',
    dataIndex: 'videoMaterial',
    key: 'videoMaterial',
    width: '30%',
  },
  {
    title: '操作',
    key: 'action',
    align: 'center',
    width: '20%',
  }
];

function openFolderHandler(dir: any) {
  shell.openPath(dir)
}

async function selectDirectoryHandler() {
  s1.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke()
}

async function batchCreationFolderHandler() {
  const clipboardText = await navigator.clipboard.readText();
  const directoryNames = clipboardText
    .split('\n')
    .map(row => row.split('\t'))
    .filter(([title, productId]) => title && productId && title !== "商品名称")
    .map(([title, productId]) =>
      `S1---${title.replace(/\r/g, '')}---${productId.replace(/\r/g, '')}---${nanoid(8)}`
    );

  await Promise.all(directoryNames.map(name =>
    ipcRendererChannel.CreateDirectory.invoke({
      dirPath: s1.taskDirectory,
      dirName: name
    })
  ));
}
</script>

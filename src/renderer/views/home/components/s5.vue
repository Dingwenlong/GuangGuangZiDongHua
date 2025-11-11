<template>
  <div
    class="w-full h-full grid overflow-auto"
    style="grid-template-rows: minmax(min-content, 60px) minmax(200px, 1fr)">
    <div class="items-center gap-10 flex justify-between">
      <!-- <span class="text-[#666666] text-[12px]"
        >S3/S4为自动工作流，不支持单独使用</span
      > -->
      <!-- <div></div> -->
      <div
        class="w-2/12 h-32 text-[12px] leading-35 text-gray-400 content-center text-right whitespace-nowrap">
        自动接续工作流{{ s4.autoHandOnWorkflow ? '开启' : '关闭' }}
        <Switch
          v-model:checked="s4.autoHandOnWorkflow"
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
            <p
              v-for="(item, index) in record.videoMaterial"
              :key="index"
              style="margin: 4px 0">
              {{ item }}
            </p>
          </template>
          <template v-else-if="column.key === 'action'" class="text-center">
            <Button
              type="primary"
              @click="openFolderHandler(record.productDirectory)"
              >打开文件夹</Button
            >
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, reactive, watch, computed } from 'vue';
import { Switch, Button, Table, type TableColumnType } from 'ant-design-vue';
import path from 'path-browserify';

const { ipcRendererChannel, shell } = window;

const s5 = reactive({
  taskDirectory: 'test',
});
const s4 = ref({
  autoHandOnWorkflow: true,
});
const tableData = ref<any>([]);

function openFolderHandler(dir: string) {
  shell.openPath(path.join(s5.taskDirectory, dir));
}

watch(s5, val => {
  // 监听文件夹
  if (val.taskDirectory) {
    ipcRendererChannel.StartMonitoringDirectory.invoke(val.taskDirectory);
  }
});

watch(s4.value, val => {
  ipcRendererChannel.UpdateWorkbenchData.invoke({
    stepNo: 's4',
    sData: { ...val },
  });
});

onMounted(() => {
  // 获取历史缓存
  ipcRendererChannel.GetWorkbenchData.invoke('s1').then(workbenchS1 => {
    s5.taskDirectory = workbenchS1.taskDirectory ?? '';
  });
  ipcRendererChannel.GetWorkbenchData.invoke('s5').then(workbenchS5 => {
    s4.value = { ...workbenchS5 };
  });

  // 绑定文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (_, arg: { root: string; structure: any[] }) => {
      // console.log(arg);
      tableData.value = arg.structure
        .filter(dir => {
          const [first, seconds, ..._] = dir.name;
          // console.log(dir.name);
          return dir.type === 'directory' && first === 'S' && seconds === '4';
        })
        .map(dir => {
          return {
            taskDirectory: s5.taskDirectory,
            productDirectory: dir.path.replace(s5.taskDirectory + '\\', ''),
            videoMaterial: dir.children
              .filter((file: any) => file.type === 'file')
              .map((file: any) => file.name),
          };
        });
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
    title: '商品目录',
    dataIndex: 'productDirectory',
    key: 'productDirectory',
    width: '30%',
  },
  {
    title: '视频素材',
    dataIndex: 'videoMaterial',
    key: 'videoMaterial',
    width: '40%',
  },
  {
    title: '操作',
    key: 'action',
    align: 'center',
    width: '20%',
  },
];
</script>

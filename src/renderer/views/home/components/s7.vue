<template>
  <div
    class="w-full h-full grid overflow-y-auto overflow-x-hidden"
    style="grid-template-rows: minmax(min-content, 50px) minmax(200px, 1fr)">
    <div class="flex flex-row items-baseline flex-wrap gap-10">
      <div class="w-full flex justify-between flex-row items-center gap-10">
        <Input
          class="w-6/12!"
          readonly
          v-model:value="s7.taskDirectory"
          :disabled="s7.running"
          placeholder="点击选择任务监听目录文件夹"
          @click="selectDirectoryHandler" />
        <div
          class="w-6/12! h-32 text-[12px] text-gray-400 content-center text-right">
          自动持续检测{{ s7.running ? '开启' : '关闭' }}
          <Switch
            v-model:checked="s7.running"
            :disabled="!s7.taskDirectory"
            class="mt-[-3px]"
            size="small" />
        </div>
      </div>
      <div class="w-full flex flex-row justify-end gap-10"></div>
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
          <template v-if="column.dataIndex === 'file'"> </template>
          <template v-else-if="column.key === 'action'" class="text-center">
            <Button
              type="text"
              @click="showFolderHandler(s7.taskDirectory + '\\' + record.file)"
              >在文件夹中显示</Button
            >
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
  Input,
  Table,
  Button,
  Switch,
  type TableColumnType,
} from 'ant-design-vue';

interface S7 {
  taskDirectory: string;
  running: boolean;
}

const { shell, ipcRendererChannel } = window;

const s7 = ref<S7>({
  taskDirectory: '',
  running: false,
});
const tableData = ref<any>([]);
let currMonitoringDirectory = '';

onMounted(() => {
  ipcRendererChannel.GetWorkbenchData.invoke('s7').then(workbench => {
    s7.value.taskDirectory = workbench.taskDirectory;
    s7.value.running = workbench.running;
  });

  watch(s7.value, async newValue => {
    ipcRendererChannel.UpdateWorkbenchData.invoke({
      stepNo: 's7',
      sData: { ...newValue },
    });
    if (
      !newValue.running ||
      newValue.taskDirectory !== currMonitoringDirectory
    ) {
      await ipcRendererChannel.StopMonitoringDirectory.invoke(
        currMonitoringDirectory
      );
      tableData.value = [];
    }
    if (newValue.taskDirectory && newValue.running)
      await ipcRendererChannel.StartMonitoringDirectory.invoke(
        newValue.taskDirectory
      );
    currMonitoringDirectory = newValue.taskDirectory;
  });

  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (_, arg: { root: string; structure: any[] }) => {
      if (arg.root === s7.value.taskDirectory) {
        tableData.value = arg.structure
          .filter(file => file.isVideo)
          .map(file => {
            return {
              file: file.name,
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
    title: '目录文件',
    dataIndex: 'file',
    key: 'file',
    width: '80%',
  },
  {
    title: '操作',
    key: 'action',
    align: 'center',
    width: '20%',
  },
];

/**
 * 打开文件夹
 */
function showFolderHandler(fullPath: any) {
  shell.showItemInFolder(fullPath);
}

/**
 * 选择文件夹
 */
async function selectDirectoryHandler() {
  s7.value.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke();
}
</script>

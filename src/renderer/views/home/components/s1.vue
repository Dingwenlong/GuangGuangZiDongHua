<template>
  <div
    class="w-full h-full grid overflow-auto"
    style="grid-template-rows: minmax(min-content, 120px) minmax(200px, 1fr)">
    <div class="mb-15 flex flex-row items-center flex-wrap gap-10">
      <div class="w-full flex justify-between flex-row items-center gap-10">
        <Input
          class="w-6/12!"
          readonly
          v-model:value="s1.taskDirectory"
          placeholder="点击选择任务监听目录文件夹"
          @click="selectDirectoryHandler" />
        <div
          class="w-3/12 h-32 text-[12px] text-gray-400 content-center text-center">
          商品素材时长
          <Input
            class="w-60! h-20! text-center"
            readonly
            v-model:value="s1.materialDuration" />
          秒
        </div>
        <div
          class="w-3/12 h-32 text-[12px] text-gray-400 content-center text-right">
          自动持续检测{{ s1.autoMonitoring ? '开启' : '关闭' }}
          <Switch
            v-model:checked="s1.autoMonitoring"
            class="mt-[-3px]"
            size="small" />
        </div>
      </div>
      <div class="w-full flex flex-row justify-end gap-10">
        <Button
          type="primary"
          :disabled="!s1.taskDirectory"
          @click="batchCreationFolderHandler"
          >批量创建商品文件夹</Button
        >
        <Button
          type="primary"
          :disabled="!s1.taskDirectory"
          @click="() => (s1.running = !s1.running)"
          >{{ !s1.running ? '开始' : '结束' }}执行自动工作流任务</Button
        >
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
              type="text"
              @click="
                openFolderHandler(
                  record.taskDirectory + '\\' + record.productDirectory
                )
              "
              >打开文件夹</Button
            >
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, reactive, watch } from 'vue';
import {
  Switch,
  Input,
  Table,
  Button,
  type TableColumnType,
} from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { sanitizeFolderName } from '@renderer/utils/string'

const { shell, ipcRendererChannel } = window;

const s1 = reactive({
  taskDirectory: '',
  materialDuration: '20',
  autoMonitoring: true,
  intervalSeconds: 5,
  running: false,
});
const tableData = ref<any>([]);

onMounted(() => {
  ipcRendererChannel.GetWorkbenchData.invoke('s1').then(workbench => {
    s1.taskDirectory = workbench.taskDirectory ?? '';
    s1.autoMonitoring = workbench.autoMonitoring ?? true;
    s1.running = workbench.running ?? false;
    if (s1.taskDirectory && s1.autoMonitoring && !s1.running) s1.running = true;
  });

  watch(s1, async (newValue, oldValue) => {
    ipcRendererChannel.UpdateWorkbenchData.invoke({
      stepNo: 's1',
      sData: { ...newValue },
    });

    if (newValue.taskDirectory != oldValue.taskDirectory)
      await ipcRendererChannel.StopMonitoringDirectory.invoke(
        oldValue.taskDirectory
      );
    if (newValue.taskDirectory)
      await ipcRendererChannel.StartMonitoringDirectory.invoke(
        newValue.taskDirectory
      );
  });

  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (_, arg: { root: string; structure: any[] }) => {
      if (arg.root === s1.taskDirectory) {
        tableData.value = arg.structure
          .filter(dir => {
            const [first, seconds, ..._] = dir.name;
            return dir.type === 'directory' && first === 'S'; //&& seconds === '1';
          })
          .sort((a, b) => {
            const stepPartsA = a.name.split('---');
            const stepPartsB = b.name.split('---');
            return stepPartsA[0] === stepPartsB[0]
              ? Number(stepPartsA[1]) - Number(stepPartsB[1])
              : stepPartsA[0].localeCompare(stepPartsB[0]);
          })
          .map(dir => {
            const children = dir.children as any[];
            return {
              taskDirectory: s1.taskDirectory,
              productDirectory: dir.path.replace(s1.taskDirectory + '\\', ''),
              videoMaterial: children
                .filter((file: any) => file.isVideo && file.type === 'file')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((file: any) => file.name),
            };
          });
      }
    }
  );

  ipcRendererChannel.CheckKaipaiLoginStatus.invoke().then(isLogin => {
    console.log('登录检测结果:', isLogin);
  });
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
    width: '30%',
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
function openFolderHandler(dir: any) {
  shell.openPath(dir);
}

/**
 * 选择文件夹
 */
async function selectDirectoryHandler() {
  s1.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke();
}

/**
 * 批量创建文件夹
 */
async function batchCreationFolderHandler() {
  const clipboardText = await navigator.clipboard.readText();
  const directoryNames = clipboardText
    .split('\n')
    .map(row => row.split('\t'))
    .filter(([title, productId]) => title && productId && title !== '商品名称')
    .map(
      ([title, productId], i) =>
        `S1---${i + 1}---${sanitizeFolderName(title)}---${productId.replace(/\r/g, '')}---${nanoid(8)}`
    );

  await Promise.all(
    directoryNames.map(name =>
      ipcRendererChannel.CreateDirectory.invoke({
        dirPath: s1.taskDirectory,
        dirName: name,
      })
    )
  );
}
</script>

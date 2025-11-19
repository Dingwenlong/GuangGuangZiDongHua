<template>
  <div
    class="w-full h-full grid overflow-y-auto overflow-x-hidden"
    style="grid-template-rows: minmax(min-content, 120px) minmax(200px, 1fr)">
    <div class="flex flex-row items-baseline flex-wrap gap-10">
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
          自动持续检测{{ s1.running ? '开启' : '关闭' }}
          <Switch v-model:checked="s1.running" class="mt-[-3px]" size="small" />
        </div>
      </div>
      <div class="w-full flex flex-row justify-end gap-10">
        <Button
          type="primary"
          :disabled="!s1.taskDirectory"
          @click="batchCreationFolderHandler"
          >批量创建商品文件夹</Button
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
import { sanitizeFolderName } from '@renderer/utils/string';

const { shell, ipcRendererChannel } = window;

const s1 = reactive({
  taskDirectory: '',
  materialDuration: '20',
  intervalSeconds: 5,
  running: false,
});
const tableData = ref<any>([]);
let startFolderIndex = 0;

onMounted(async () => {
  try {
    // 添加超时保护，防止获取工作台数据时卡住
    await Promise.race([
      (async () => {
        const workbench = await ipcRendererChannel.GetWorkbenchData.invoke(
          's1'
        );
        s1.taskDirectory = workbench.taskDirectory ?? '';
        s1.running = false;
        if (workbench.running) {
          await ipcRendererChannel.UpdateWorkbenchData.invoke({
            stepNo: 's1',
            sData: Object.assign({ ...s1 }, { running: false }),
          });
        }
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('获取S1工作台数据超时')), 5000);
      }),
    ]).catch(error => {
      console.error('获取S1工作台数据失败:', error);
    });

    watch(s1, async (newValue, oldValue) => {
      try {
        await ipcRendererChannel.UpdateWorkbenchData.invoke({
          stepNo: 's1',
          sData: { ...newValue },
        });
        if (
          newValue.taskDirectory !== oldValue.taskDirectory ||
          !newValue.running
        )
          await ipcRendererChannel.StopMonitoringDirectory.invoke(
            oldValue.taskDirectory
          );
        if (newValue.taskDirectory && newValue.running)
          await ipcRendererChannel.StartMonitoringDirectory.invoke(
            newValue.taskDirectory
          );
      } catch (error) {
        console.error('更新S1工作台数据失败:', error);
      }
    });

    // 添加错误处理，防止目录监听回调失败
    ipcRendererChannel.MonitoringDirectoryCallback.on(
      (_, arg: { root: string; structure: any[] }) => {
        try {
          if (arg.root === s1.taskDirectory) {
            startFolderIndex = Math.max(
              ...arg.structure.map(dir => {
                const [step, no, ..._] = dir.name.split('---');
                return step === 'S1' ? ~~no : 0;
              })
            );
            tableData.value = arg.structure
              .filter(dir => {
                const [first, ..._] = dir.name;
                return dir.type === 'directory' && first === 'S';
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
                  productDirectory: dir.path.replace(
                    s1.taskDirectory + '\\',
                    ''
                  ),
                  videoMaterial: children
                    .filter((file: any) => file.isVideo && file.type === 'file')
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((file: any) => file.name),
                };
              });
          }
        } catch (error) {
          console.error('处理目录监听回调失败:', error);
        }
      }
    );

    // 添加超时保护，防止登录检测卡住
    Promise.race([
      ipcRendererChannel.CheckKaipaiLoginStatus.invoke(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('登录检测超时')), 3000);
      }),
    ])
      .then(isLogin => {
        console.log('登录检测结果:', isLogin);
      })
      .catch(error => {
        console.error('登录检测失败:', error);
      });

    console.log('S1组件初始化完成');
  } catch (error) {
    console.error('S1组件初始化失败:', error);
  }
});

onUnmounted(() => {
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
    .filter(
      ([title, category, productId]) =>
        title && category && productId && title !== '商品名称'
    )
    .map(([title, category, productId], i) => {
      startFolderIndex += 1;
      return `S1---${startFolderIndex}---${sanitizeFolderName(title).replaceAll(
        ' ',
        ''
      )}---${category}---${productId.replace(/\r/g, '')}---${nanoid(8)}`;
    });

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

<template>
  <div class="mb-15 flex flex-row items-center flex-wrap gap-10">
    <div class="w-full flex justify-between flex-row items-center gap-10">
      <Input
        class="w-6/12!"
        readonly
        v-model:value="s1.taskDirectory"
        placeholder="点击选择任务监听目录文件夹"
        @click="selectDirectoryHandler"
        :disabled="s1.taskDirectory !== ''" />
      <div
        class="w-3/12 h-32 text-[12px] leading-35 text-gray-400 content-center text-right">
        自动持续检测{{ s6.autoHandOnWorkflow ? '开启' : '关闭' }}
        <Switch v-model:checked="s6.autoHandOnWorkflow" size="small" />
      </div>
    </div>
    <div class="w-full flex flex-row justify-end gap-10">
      <Button
        type="primary"
        @click="() => startOrStopTaskHandler(!s6.autoHandOnWorkflow)"
        >{{
          !s6.autoHandOnWorkflow ? '开始' : '结束'
        }}执行素材高清化任务</Button
      >
    </div>
  </div>
  <div class="list" style="margin-top: 20px; padding: 0 10px">
    <Table
      :columns="columns"
      :data-source="data"
      size="small"
      :scroll="{ scrollToFirstRowOnChange: true }"
      bordered
      :pagination="false">
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'videoMaterial'">
          <p
            v-for="(item, index) in record.videoMaterial"
            :key="index"
            style="margin: 4px 0">
            {{ item }}
          </p>
        </template>
        <template v-else-if="column.dataIndex === 'address'">
          <p
            v-for="(item, index) in record.address.split(',')"
            :key="index"
            style="margin: 4px 0">
            {{ item }}
          </p>
        </template>
        <template v-else-if="column.key === 'action'">
          <span>
            <Button
              type="primary"
              @click="
                openFolder(s1.taskDirectory + '\\' + record.productDirectory)
              "
              >打开文件夹</Button
            >
          </span>
        </template>
      </template>
    </Table>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  Switch,
  Input,
  Table,
  Button,
  type TableColumnType,
} from 'ant-design-vue';
const { shell, ipcRendererChannel } = window;

const s1 = reactive({
  taskDirectory: '',
});
const s6 = ref({
  autoHandOnWorkflow: false,
});

const columns: TableColumnType[] = [
  {
    title: '任务目录',
    dataIndex: 'taskDirectory',
    key: 'taskDirectory',
    width: '20%',
  },
  {
    title: '视频素材-去字幕',
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

const data = ref<any>([]);

async function selectDirectoryHandler() {
  s1.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke();
}

function openFolder(path: string) {
  shell.openPath(path);
}

const videoMonitoringRunning = ref(false);

function startOrStopTaskHandler(start = true) {
  // 更新 s6 的 running 状态
  ipcRendererChannel.UpdateWorkbenchData.invoke({
    stepNo: 's6',
    sData: { ...s6.value, running: start },
  });

  // guanghe();
}

function guanghe() {
  ipcRendererChannel.guangheCes.invoke();
}

// 调用高清化脚本
function setCookie(filePath: string) {
  console.log('设置Cookie并执行高清化');

  try {
    // 处理文件路径（使用/代替\避免转义问题）
    // const firstFilePath = 'C:\\Users\\ASUS\\Downloads\\S5-testMP4.mp4';

    // 调用高清化脚本
    ipcRendererChannel.RunVideoQualityFix.invoke({
      filePath: filePath,
      targetDir: 'C:/Users/ASUS/Downloads/ces/S5-asd',
    })
      .then((result: any) => {
        // 直接处理返回结果
        if (result && result.success) {
          console.log('去水印成功:', result.message);
          console.log('处理后的文件路径:', result.filePath);
          // 日志信息会通过IPC事件自动显示在页面上
        } else {
          console.error('去水印失败:', result?.message || '未知错误');
        }
      })
      .catch(error => {
        console.error('调用去水印脚本时出错:', error);
      });
  } catch (error: any) {
    console.error('执行去水印脚本时出错:', error.message);
  }
}

onMounted(async () => {
  // 获取历史缓存
  ipcRendererChannel.GetWorkbenchData.invoke('s1').then(workbenchS1 => {
    s1.taskDirectory = workbenchS1.taskDirectory ?? '';
  });
  ipcRendererChannel.GetWorkbenchData.invoke('s6').then(workbenchS6 => {
    s6.value = { ...workbenchS6 };
  });
  // 获取历史缓存数据
  // await ipcRendererChannel.GetWorkbenchData.invoke('s6').then(
  //   (workbench: any) => {
  //     s6.value = workbench ?? {
  //       taskDirectory: '',
  //       autoHandOnWorkflow: false,
  //       intervalSeconds: 5,
  //     };
  //   }
  // );

  // 绑定文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (event, arg: { root: string; structure: any[] }) => {
      data.value = arg.structure
        .filter(dir => {
          const [first, seconds, ..._] = dir.name;

          return dir.type === 'directory' && first === 'S' && seconds === '6';
        })
        .map(dir => {
          return {
            taskDirectory: s1.taskDirectory,
            productDirectory: dir.path.replace(s1.taskDirectory + '\\', ''),
            videoMaterial: dir.children
              .filter((file: any) => file.isVideo && file.type === 'file')
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
</script>

<style scoped>
.from {
  padding: 5px 10px;
  display: flex;
  justify-content: space-between;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
</style>

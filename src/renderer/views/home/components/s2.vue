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
        自动持续检测{{ s2.autoMonitoring ? '开启' : '关闭' }}
        <Switch v-model:checked="s2.autoMonitoring" size="small" />
      </div>
    </div>
    <div class="w-full flex flex-row justify-end gap-10">
      <Button
        type="primary"
        @click="() => startOrStopTaskHandler(!s2.autoMonitoring)"
        >{{ !s2.autoMonitoring ? '开始' : '结束' }}执行素材去水印任务</Button
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
  taskDirectory: 'test',
});
const s2 = ref({
  autoMonitoring: false,
  intervalSeconds: 5,
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
  if (start && s1.taskDirectory && !videoMonitoringRunning.value) {
    videoMonitoringRunning.value = true;
    ipcRendererChannel.StartMonitoringDirectory.invoke(s1.taskDirectory);
  } else if (!start && videoMonitoringRunning.value) {
    videoMonitoringRunning.value = false;
    ipcRendererChannel.StopMonitoringDirectory.invoke();
  }
  setCookie();
}

// 调用去水印脚本
function setCookie() {
  console.log('设置Cookie并执行去水印');

  try {
    // 处理文件路径（使用/代替\避免转义问题）
    const firstFilePath =
      'C:\\Users\\ASUS\\Downloads\\ces\\S2-aaa\\S1---33019725083-1-192.mp4';

    // 调用去水印脚本
    ipcRendererChannel.RunWatermarkRemoval.invoke({
      filePath: firstFilePath,
      targetDir: 'C:/Users/ASUS/Downloads/kaipai_output',
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

// 调用登录检测脚本
// function checkLogin() {
//   console.log('开始检测登录状态');

//   try {
//     // 调用登录检测脚本
//     ipcRendererChannel.CheckKaipaiLoginStatus.invoke()
//       .then(result => {
//         console.log('登录检测结果:', result);
//         // 日志信息会通过IPC事件自动显示在页面上
//       })
//       .catch(error => {
//         console.error('检测登录状态时出错:', error);
//       });
//   } catch (error: any) {
//     console.error('检测登录状态时出错:', error.message);
//   }
// }

watch(s2.value, async (val, _) => {
  ipcRendererChannel.UpdateWorkbenchData.invoke({
    stepNo: 's1',
    sData: { ...val },
  });
  // 监听视频
  // if(!val.autoMonitoring) {
  //   videoMonitoringRunning.value = false;
  //   ipcRendererChannel.StopMonitoringVideo.invoke();
  // }
});

onMounted(async () => {
  // 获取历史缓存
  ipcRendererChannel.GetWorkbenchData.invoke('s1').then(workbenchS1 => {
    s1.taskDirectory = workbenchS1.taskDirectory ?? '';
  });
  ipcRendererChannel.GetWorkbenchData.invoke('s2').then(workbenchS2 => {
    s2.value = { ...workbenchS2 };
  });

  // 获取历史缓存数据
  await ipcRendererChannel.GetWorkbenchData.invoke('s2').then(
    (workbench: any) => {
      s2.value = workbench ?? {
        autoMonitoring: false,
        intervalSeconds: 5,
      };
    }
  );

  // 绑定文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (event, arg: { root: string; structure: any[] }) => {
      console.log(arg);
      data.value = arg.structure
        .filter(dir => {
          return dir.type === 'directory' && dir.name === '视频去字幕任务';
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

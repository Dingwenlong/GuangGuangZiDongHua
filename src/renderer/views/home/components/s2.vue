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
        自动持续检测{{ s2.autoHandOnWorkflow ? '开启' : '关闭' }}
        <Switch v-model:checked="s2.autoHandOnWorkflow" size="small" />
      </div>
    </div>
    <div class="w-full flex flex-row justify-end gap-10">
      <Button
        type="primary"
        @click="() => startOrStopTaskHandler(!s2.autoHandOnWorkflow)"
        >{{
          !s2.autoHandOnWorkflow ? '开始' : '结束'
        }}执行素材去水印任务</Button
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
            <Button type="primary" @click="openFolder(record.productDirectory)"
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

function startOrStopTaskHandler(start = true) {
  // 更新 s2 的 running 状态
  ipcRendererChannel.UpdateWorkbenchData.invoke({
    stepNo: 's2',
    sData: { autoHandOnWorkflow: s2.value.autoHandOnWorkflow, running: start },
  });
  // const dsjao = [
  //   'C:\\Users\\ASUS\\Downloads\\ces\\S1---33019725083-1-192.mp4',
  //   'C:\\Users\\ASUS\\Downloads\\ces\\S3---33019725083-1-192.mp4',
  // ];
  // dsjao.forEach(item => {
  //   setCookie(item);
  // });
}

// 调用去水印脚本
function setCookie(filePath: string) {
  console.log('设置Cookie并执行去水印');

  try {
    // 调用去水印脚本
    ipcRendererChannel.RunWatermarkRemoval.invoke({
      filePath: filePath,
      targetDir: 'C:/Users/ASUS/Downloads/ces',
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
  // ipcRendererChannel.UpdateWorkbenchData.invoke({
  //   stepNo: 's1',
  //   sData: { ...val },
  // });
  ipcRendererChannel.UpdateWorkbenchData.invoke({
    stepNo: 's2',
    sData: { ...val },
  });
  // 监听视频
  // if(!val.autoMonitoring) {
  //   videoMonitoringRunning.value = false;
  //   ipcRendererChannel.StopMonitoringVideo.invoke();
  // }
});

onMounted(async () => {
  try {
    // 添加超时保护，防止获取工作台数据时卡住
    await Promise.race([
      (async () => {
        // 获取历史缓存
        const workbenchS1 = await ipcRendererChannel.GetWorkbenchData.invoke('s1');
        s1.taskDirectory = workbenchS1.taskDirectory ?? '';
        
        const workbenchS2 = await ipcRendererChannel.GetWorkbenchData.invoke('s2');
        s2.value = { ...workbenchS2 };
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('获取工作台数据超时')), 5000);
      })
    ]).catch(error => {
      console.error('获取工作台数据失败:', error);
    });

    // 添加错误处理，防止目录监听回调失败
    ipcRendererChannel.MonitoringDirectoryCallback.on(
      (event, arg: { root: string; structure: any[] }) => {
        try {
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
        } catch (error) {
          console.error('处理目录监听回调失败:', error);
        }
      }
    );
    
    console.log('组件初始化完成');
  } catch (error) {
    console.error('组件初始化失败:', error);
  }
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

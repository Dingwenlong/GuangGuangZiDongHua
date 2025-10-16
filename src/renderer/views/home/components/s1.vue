<template>
  <div class="flex flex-row items-center flex-wrap gap-10">
    <div class="w-full flex justify-between flex-row items-center gap-10">
      <Input class="w-6/12!" readonly v-model:value="s1.taskDirectory" placeholder="点击选择任务监听目录文件夹" @click="selectDirectory" />
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
      <Button type="primary">批量创建商品文件夹</Button>
      <Button type="primary" :disabled="s1.autoMonitoring">执行自动工作流任务</Button>
    </div>
  </div>
  <div class="mt-15">
    <Table :columns="columns" :data-source="data" :bordered="true">
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'address'">
          <p
            v-for="(item, index) in record.address.split(',')"
            :key="index"
            style="margin: 4px 0"
          >
            {{ item }}
          </p>
        </template>
        <template v-else-if="column.key === 'action'" class="text-center">
          <Button type="primary"@click="openFolder(record)">打开文件夹</Button>
        </template>
      </template>
    </Table>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, reactive, watch } from 'vue';
import {
  Switch,
  Input,
  Table,
  Button,
  type TableColumnType
} from 'ant-design-vue';
import Timer from '@renderer/utils/timer'

const { shell, ipcRendererChannel } = window

const s1 = reactive({
  taskDirectory: 'test',
  materialDuration: '20',
  autoMonitoring: false,
  intervalSeconds: 5
});

const columns: TableColumnType[] = [
  {
    title: '任务目录',
    dataIndex: 'name',
    key: 'name'
  },
  {
    title: '商品目录',
    dataIndex: 'age',
    key: 'age'
  },
  {
    title: '视频素材',
    dataIndex: 'address',
    key: 'address'
  },
  {
    title: '操作',
    key: 'action',
    align: 'center'
  }
];

const data = [
  {
    name: 'Z:\张海涛15898900999',
    age: 'S1---海尔微型滚筒洗衣机---5698778665',
    address:
      'S5---海尔微型滚筒洗衣机---5698778665---1.mp4,S5---海尔微型滚筒洗衣机---5698778665---2.mp4,S5---海尔微型滚筒洗衣机---5698778665---3.mp4,S5---海尔微型滚筒洗衣机---5698778665---4.mp4'
  }
];

watch(s1, (val, _) => {
  console.log('watch', val);
  if(!val.autoMonitoring) {
    //任务停止
    ipcRendererChannel.StopMonitoring.invoke();
  }
});

onMounted(async () => {
  const workbench = await ipcRendererChannel.GetWorkbenchData.invoke();
  s1.taskDirectory = workbench.taskDirectory ?? '';
  s1.autoMonitoring = workbench.autoMonitoring ?? true;
  console.log('workbench', workbench)
  Timer.interval(s1.intervalSeconds * 1000, () => {
    if(s1.taskDirectory && s1.autoMonitoring) {
      console.log('条件通过，可以执行')
      // ipcRendererChannel.StartMonitoring.invoke(s1.taskDirectory);
    }
  });
})

async function selectDirectory() {
  s1.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke()
}

function openFolder(record: any) {
  console.log(record);
  shell.openExternal('C:/')
}
</script>

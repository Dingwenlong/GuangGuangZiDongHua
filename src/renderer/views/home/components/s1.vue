<template>
  <div>
    <div class="from">
      <span>
        <Select v-model:value="queryForm.input" style="width: 160px" placeholder="Tags">
          <SelectOption value="1">商品</SelectOption>
          <SelectOption value="2">服务</SelectOption>
        </Select>
      </span>
      <Button type="primary">任务检测目录</Button>
      <Button type="primary">批量创建商品文件夹</Button>

      <span>
        商品素材时长
        <Input v-model:value="queryForm.duration" style="width: 40px; height: 20px" disabled />
        秒
      </span>
      <span>自动持续检测开启 <Switch v-model:checked="queryForm.autoCheck" /></span>
      <Button type="primary">执行自动工作流任务</Button>
    </div>
    <div class="list" style="margin-top: 20px; padding: 0 10px">
      <Table :columns="columns" :data-source="data">
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
          <template v-else-if="column.key === 'action'">
            <span>
              <Button type="primary"@click="openFolder(record)">打开文件夹</Button>
            </span>
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { reactive } from 'vue';
import {
  Switch,
  Select,
  SelectOption,
  Table,
  Button,
  Input
} from 'ant-design-vue';

const queryForm = reactive({
  input: '',
  duration: '20',
  autoCheck: false
});

const columns = [
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
    key: 'action'
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

function openFolder(record: any) {
  console.log(record);
}
</script>

<style scoped>
.from {
  padding: 5px 10px;
  display: flex;
  justify-content: space-between;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap; /* 新增：防止元素溢出换行 */
  gap: 10px; /* 新增：增加元素间距，避免拥挤 */
}
</style>

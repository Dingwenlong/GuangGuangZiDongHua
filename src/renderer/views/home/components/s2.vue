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
      <Button type="primary" @click="setCookie">设置开拍Cookie</Button>
      <Button type="primary">Cookie设置成功</Button>

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
              <Button type="primary" @click="openFolder(record)">打开文件夹</Button>
            </span>
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, reactive } from 'vue';
import { Switch, Select, SelectOption, Table, Button } from 'ant-design-vue';

  const { ipcRendererChannel } = window;

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
    name: 'C:/Users/ASUS/Downloads',
    address: 'S5---海尔微型滚筒洗衣机---5698778665---1.mp4'
  },
  {
    name: 'Z:\张海涛15898900999',
    address: 'S5---海尔微型滚筒洗衣机---5698778665---1.mp4'
  }
];

function openFolder(record: any) {
  console.log(record.name);
}

// 调用去水印脚本
function setCookie() {
  console.log('设置Cookie并执行去水印');

  // 检查playTrigger接口是否可用

  try {
    // 处理文件路径（使用/代替\避免转义问题）
    const firstFilePath = 'C:/Users/ASUS/Downloads/S1-33019725083-1-192.mp4';

    // 1. 调用去水印脚本 - 使用async/await直接获取返回值
    ipcRendererChannel.RunWatermarkRemoval.invoke({
      filePath: firstFilePath,
      targetDir: 'C:/Users/ASUS/Downloads/kaipai_output'
    }).then(result => {
      // 直接处理返回结果
      if (result.success) {
        console.log('去水印成功:', result.message);
        console.log('处理后的文件路径:', result.filePath);
        // 这里可以添加UI提示，如createMessage.success(result.message);
      } else {
        console.error('去水印失败:', result.message);
        // createMessage.error(result.message);
      }
    }).catch(error => {
      console.error('调用去水印脚本时出错:', error);
      // createMessage.error(`执行去水印脚本时出错: ${error.message}`);
    });
  } catch (error: any) {
    console.error('执行去水印脚本时出错:', error.message);
    // createMessage.error(`执行去水印脚本时出错: ${error.message}`);
  }
}

// 调用登录检测脚本
function checkLogin() {
  console.log('开始检测登录状态');

  try {
    // 直接使用Promise获取登录检测结果
    ipcRendererChannel.CheckLoginStatus.invoke().then(result => {
      console.log('登录检测结果:', result);
      // 区分三种状态：已登录、未登录、检测失败
      if (result.isLoggedIn === true) {
        console.log('用户已登录');
        // createMessage.success(result.message);
      } else if (result.isLoggedIn === false) {
        console.log('用户未登录');
        // createMessage.warning(result.message);
      } else {
        console.log('登录检测失败');
        // createMessage.error(result.message);
      }
    }).catch(error => {
      console.error('检测登录状态时出错:', error);
      // createMessage.error(`检测登录状态时出错: ${error.message}`);
    });
  } catch (error: any) {
    console.error('检测登录状态时出错:', error.message);
    // createMessage.error(`检测登录状态时出错: ${error.message}`);
  }
}
onMounted(() => {
  checkLogin();
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

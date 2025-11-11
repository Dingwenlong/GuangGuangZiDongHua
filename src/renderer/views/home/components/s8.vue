<template>
  <div
    class="w-full h-full grid overflow-auto"
    style="grid-template-rows: minmax(min-content, 120px) minmax(200px, 1fr)">
    <div class="mb-15 flex flex-row items-center flex-wrap gap-10">
      <div class="w-full flex justify-between flex-row items-center gap-10">
        <Input
          class="w-6/12!"
          readonly
          v-model:value="s7.taskDirectory"
          placeholder="点击选择任务监听目录文件夹"
          @click="selectDirectoryHandler" />
      </div>
      <div class="w-full flex flex-row justify-end gap-10">
        <Button type="primary" :disabled="!s7.taskDirectory" @click="showModal"
          >批量创建逛逛号文件夹</Button
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
              @click="openFolderHandler(s7.taskDirectory + '\\' + record.first)"
              >打开文件夹</Button
            >
          </template>
        </template>
      </Table>
    </div>

    <!-- 批量创建文件夹弹窗 -->
    <Modal
      v-model:open="modalVisible"
      title="批量创建逛逛号文件夹"
      width="1000px"
      ok-text="确认"
      cancel-text="取消"
      @ok="handleModalOk"
      @cancel="handleModalCancel">
      <div class="mb-4">
        <Button type="primary" @click="loadClipboardData"
          >从剪切板加载数据</Button
        >
        <span class="ml-2 text-gray-500"
          >请确保剪切板中的数据格式为：逛逛昵称、分类、逛逛ID、标签、话题，每行一条记录，用制表符分隔</span
        >
      </div>
      <Table
        :columns="modalColumns"
        :data-source="modalTableData"
        :pagination="false"
        size="small"
        bordered
        :scroll="{ y: 400 }">
        <template #bodyCell="{ column, record, index }">
          <template
            v-if="
              column.dataIndex === 'name' ||
              column.dataIndex === 'category' ||
              column.dataIndex === 'guangId'
            ">
            <Input
              v-model:value="record[column.dataIndex]"
              placeholder="请输入" />
          </template>
          <template
            v-else-if="
              column.dataIndex === 'tags' || column.dataIndex === 'topics'
            ">
            <Input
              v-model:value="record[column.dataIndex]"
              placeholder="用|分隔多个值" />
          </template>
          <template v-else-if="column.key === 'action'">
            <Button type="primary" danger @click="deleteRow(index)"
              >删除</Button
            >
          </template>
        </template>
      </Table>
      <div class="mt-4">
        <Button type="dashed" class="text-gray-500!" block @click="addNewRow"
          >添加新行</Button
        >
      </div>
    </Modal>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, reactive, watch } from 'vue';
import {
  Input,
  Table,
  Button,
  Modal,
  type TableColumnType,
  message,
} from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { sanitizeFolderName } from '@renderer/utils/string';

const { shell, ipcRendererChannel } = window;

const s7 = reactive({
  taskDirectory: '',
  running: true,
});
const tableData = ref<any>([]);

// 弹窗相关状态
const modalVisible = ref(false);
const modalTableData = ref<any[]>([]);

// 弹窗表格列定义
const modalColumns: TableColumnType[] = [
  {
    title: '逛逛昵称',
    dataIndex: 'name',
    key: 'name',
    width: '20%',
  },
  {
    title: '分类',
    dataIndex: 'category',
    key: 'category',
    width: '15%',
  },
  {
    title: '逛逛ID',
    dataIndex: 'guangId',
    key: 'guangId',
    width: '15%',
  },
  {
    title: '标签',
    dataIndex: 'tags',
    key: 'tags',
    width: '20%',
  },
  {
    title: '话题',
    dataIndex: 'topics',
    key: 'topics',
    width: '20%',
  },
  {
    title: '操作',
    key: 'action',
    align: 'center',
    width: '10%',
  },
];

onMounted(() => {
  watch(s7, async (newValue, oldValue) => {
    ipcRendererChannel.UpdateWorkbenchData.invoke({
      stepNo: 's7',
      sData: { ...newValue },
    });
    if (
      newValue.taskDirectory != oldValue.taskDirectory &&
      oldValue.taskDirectory
    )
      await ipcRendererChannel.StopMonitoringDirectory.invoke(
        oldValue.taskDirectory
      );
    if (newValue.taskDirectory)
      await ipcRendererChannel.StartMonitoringDirectory.invoke(
        newValue.taskDirectory
      );
  });

  ipcRendererChannel.GetWorkbenchData.invoke('s7').then(workbench => {
    s7.taskDirectory = workbench.taskDirectory ?? '';
  });

  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (_, arg: { root: string; structure: any[] }) => {
      if (arg.root === s7.taskDirectory) {
        tableData.value = arg.structure
          .filter(dir => dir.type === 'directory')
          .map(dir => {
            // 添加过滤机制
            const children = dir.children as any[];
            return {
              first: dir.path.replace(s7.taskDirectory + '\\', ''),
              second: children.map((file: any) => file.name),
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
    title: '账号目录',
    dataIndex: 'first',
    key: 'first',
    width: '40%',
  },
  {
    title: '目录文件',
    dataIndex: 'second',
    key: 'second',
    width: '40%',
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
  s7.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke();
}

/**
 * 显示弹窗
 */
function showModal() {
  modalVisible.value = true;
  // 初始化空表格
  modalTableData.value = [];
}

/**
 * 从剪切板加载数据
 */
async function loadClipboardData() {
  try {
    const clipboardText = await navigator.clipboard.readText();
    const rows = clipboardText.split('\n').filter(row => row.trim());

    // 解析数据
    const parsedData = rows
      .map(row => {
        const columns = row.split('\t');
        return {
          key: nanoid(),
          name: columns[0] || '',
          category: columns[1] || '',
          guangId: columns[2] || '',
          tags: columns[3] || '',
          topics: columns[4] || '',
        };
      })
      .filter(item => item.name && item.name !== '逛逛昵称'); // 过滤掉标题行和空行

    if (parsedData.length > 0) {
      modalTableData.value = parsedData;
      message.success(`成功加载 ${parsedData.length} 条数据`);
    } else {
      message.warning('未从剪切板中获取到有效数据');
    }
  } catch (error) {
    message.error('读取剪切板数据失败');
    console.error(error);
  }
}

/**
 * 添加新行
 */
function addNewRow() {
  modalTableData.value.push({
    key: nanoid(),
    name: '',
    category: '',
    guangId: '',
    tags: '',
    topics: '',
  });
}

/**
 * 删除行
 */
function deleteRow(index: number) {
  modalTableData.value.splice(index, 1);
}

/**
 * 处理弹窗确认
 */
async function handleModalOk() {
  // 验证数据
  const invalidRows = modalTableData.value.filter(
    item => !item.name || !item.category || !item.guangId
  );

  if (invalidRows.length > 0) {
    message.error('请填写所有必填字段（逛逛昵称、分类、逛逛ID）');
    return;
  }

  // 执行创建文件夹逻辑
  await batchCreationFolderHandler();
  modalVisible.value = false;
}

/**
 * 处理弹窗取消
 */
function handleModalCancel() {
  modalVisible.value = false;
}

/**
 * 批量创建文件夹
 */
async function batchCreationFolderHandler() {
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(now.getDate()).padStart(2, '0')}`;

  const directories = modalTableData.value.map(item => {
    return {
      dirName: sanitizeFolderName(
        `${item.name}---${item.category}---${item.guangId}---${timeStr}---0`
      ),
      tags: item.tags ? item.tags.split('|') : [],
      topics: item.topics ? item.topics.split('|') : [],
    };
  });

  try {
    await Promise.all(
      directories.map(dir =>
        ipcRendererChannel.CreateDirectory.invoke({
          dirPath: s7.taskDirectory,
          dirName: dir.dirName,
          files: [
            {
              name: 'config.json',
              content: JSON.stringify(
                {
                  tags: dir.tags,
                  topics: dir.topics,
                },
                null,
                2
              ),
            },
          ],
        })
      )
    );
    message.success(`成功创建 ${directories.length} 个文件夹`);
  } catch (error) {
    message.error('创建文件夹失败');
    console.error(error);
  }
}
</script>

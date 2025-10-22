import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { app } from 'electron';
import { merge, omit } from 'lodash-es';
import config from '@config/index';

/**
 * 视频分镜
 * {fragmentDuration: 20, fileName: '1.mp4'}
 */
export interface VideoStoryboard {
  /**
   * 视频片段时长/s
   */
  fragmentDuration: 20;
  /**
   * 视频名称
   */
  fileName: string;
}

/**
 * 有序文件夹项
 */
export interface OrderedFolderItem {
  /**
   * 文件夹名称
   */
  folderName: string;
  /**
   * 该文件夹下的视频片段列表
   */
  videos: VideoStoryboard[];
}

/**
 * 视频片段 - 有序版本
 * 使用数组来保证文件夹顺序
 */
export type OrderedVideosChunk = OrderedFolderItem[];

// 定义存储的数据结构
export interface WorkbenchStoreSchema {
  s1: {
    taskDirectory?: string;
    materialDuration: number;
    autoMonitoring: boolean;
    intervalSeconds: number;
  };
  s3: {
    productMaterialNum: number;
    storyboardSceneThreshold: number;
    storyboardDuration1: number;
    storyboardDuration2: number;
    autoHandOnWorkflow: boolean;
  };
  /*
    {
      'C://去字幕任务/1.mp4': [
        {
          folderName: '商品文件夹1',
          videos: [{fragmentDuration: 20, fileName: '1.mp4'}, {fragmentDuration: 20, fileName: '2.mp4'}]
        },
        {
          folderName: '商品文件夹2',
          videos: [{fragmentDuration: 20, fileName: '3.mp4'}, {fragmentDuration: 20, fileName: '4.mp4'}]
        }
      ],
      'C://去字幕任务/2.mp4': [
        {
          folderName: '商品文件夹3',
          videos: [{fragmentDuration: 20, fileName: '5.mp4'}, {fragmentDuration: 20, fileName: '6.mp4'}]
        }
      ]
    }
  */
  subtitleRemoveRunningTasks: {
    [key: string]: OrderedVideosChunk;
  };
}

// 默认数据
const defaultData: WorkbenchStoreSchema = merge(
  {
    s1: {
      taskDirectory: '',
      materialDuration: 20,
      autoMonitoring: true,
      intervalSeconds: 5,
    },
    s3: {
      productMaterialNum: 4,
      storyboardSceneThreshold: 0.3,
      storyboardDuration1: 4,
      storyboardDuration2: 6,
      autoHandOnWorkflow: true,
    },
    subtitleRemoveRunningTasks: {},
  },
  config.workBenchDefault
);

class WorkbenchManager {
  private db: Low<WorkbenchStoreSchema>;

  constructor() {
    // 获取用户数据目录
    const userDataPath = app.getPath('userData');
    const dbPath = join(userDataPath, 'workbench.json');

    // 创建 JSON 文件适配器
    const adapter = new JSONFile<WorkbenchStoreSchema>(dbPath);

    // 创建 Low 实例
    this.db = new Low<WorkbenchStoreSchema>(adapter, defaultData);

    // 初始化数据库
    this.init();
  }

  /**
   * 初始化数据库
   */
  private async init(): Promise<void> {
    await this.db.read();

    // 如果数据为空，则设置默认值
    if (!this.db.data) {
      this.db.data = defaultData;
      await this.db.write();
    }
  }

  /**
   * 获取
   */
  public async getByKey<K extends keyof WorkbenchStoreSchema>(
    key: K
  ): Promise<WorkbenchStoreSchema[K]> {
    await this.db.read();
    console.log(key, this.db.data[key]);
    return this.db.data[key];
  }

  /**
   * 更新
   */
  public async updateStep<
    K extends keyof Omit<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>
  >(key: K, sData: WorkbenchStoreSchema[K]): Promise<void> {
    await this.db.read();
    this.db.data[key] = sData;
    console.log(key, this.db.data[key]);
    await this.db.write();
  }

  /**
   * 新增任务
   */
  public async pushTask(
    key: keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>,
    taskKey: string,
    taskData: OrderedVideosChunk
  ): Promise<void> {
    await this.db.read();

    // 直接设置任务数据
    this.db.data[key][taskKey] = taskData;

    console.log(`已添加任务: ${taskKey}`);
    console.log(key, this.db.data[key]);
    await this.db.write();
  }

  /**
   * 删除任务
   */
  public async removeTask(
    key: keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>,
    taskKey: string
  ): Promise<void> {
    await this.db.read();

    // 检查任务是否存在
    if (taskKey in this.db.data[key]) {
      // 直接删除属性
      delete this.db.data[key][taskKey];
      console.log(`已删除任务: ${taskKey}`);
      console.log(key, this.db.data[key]);
      await this.db.write();
    } else {
      console.warn(`尝试删除不存在的任务: ${taskKey}`);
    }
  }

  /**
   * 查询任务
   */
  public async getTaskByKey(
    key: keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>,
    taskKey: string
  ): Promise<OrderedVideosChunk | undefined> {
    const data = await this.getByKey(key);
    console.log(key, taskKey, data[taskKey]);

    // 返回任务数据，如果不存在则返回 undefined
    return data[taskKey];
  }

  /**
   * 添加文件夹到任务
   * @param key 固定为 'subtitleRemoveRunningTasks'
   * @param taskKey 任务标识（视频文件路径）
   * @param folderName 文件夹名称
   * @param videos 该文件夹下的视频片段列表
   * @param position 插入位置，默认添加到末尾
   */
  public async addFolderToTask(
    key: keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>,
    taskKey: string,
    folderName: string,
    videos: VideoStoryboard[],
    position: number = -1
  ): Promise<void> {
    await this.db.read();

    // 如果任务不存在，则初始化为空数组
    if (!this.db.data[key][taskKey]) {
      this.db.data[key][taskKey] = [];
    }

    const folderItem: OrderedFolderItem = {
      folderName,
      videos,
    };

    // 如果指定了位置且位置有效，则插入到指定位置，否则添加到末尾
    if (position >= 0 && position < this.db.data[key][taskKey].length) {
      this.db.data[key][taskKey].splice(position, 0, folderItem);
    } else {
      this.db.data[key][taskKey].push(folderItem);
    }

    console.log(`已为任务 ${taskKey} 添加文件夹 ${folderName}`);
    console.log(key, this.db.data[key]);
    await this.db.write();
  }

  /**
   * 从任务中移除文件夹
   * @param key 固定为 'subtitleRemoveRunningTasks'
   * @param taskKey 任务标识（视频文件路径）
   * @param folderName 文件夹名称
   */
  public async removeFolderFromTask(
    key: keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>,
    taskKey: string,
    folderName: string
  ): Promise<void> {
    await this.db.read();

    // 检查任务是否存在
    if (taskKey in this.db.data[key]) {
      const folders = this.db.data[key][taskKey];
      const index = folders.findIndex(item => item.folderName === folderName);

      if (index !== -1) {
        // 删除指定文件夹
        folders.splice(index, 1);

        // 如果删除后文件夹列表为空，则删除整个任务
        if (folders.length === 0) {
          delete this.db.data[key][taskKey];
        }

        console.log(`已从任务 ${taskKey} 中移除文件夹 ${folderName}`);
        console.log(key, this.db.data[key]);
        await this.db.write();
      } else {
        console.warn(`文件夹 ${folderName} 在任务 ${taskKey} 中不存在`);
      }
    } else {
      console.warn(`任务 ${taskKey} 不存在`);
    }
  }

  /**
   * 更新任务中的文件夹顺序
   * @param key 固定为 'subtitleRemoveRunningTasks'
   * @param taskKey 任务标识（视频文件路径）
   * @param folderNames 按新顺序排列的文件夹名称数组
   */
  public async updateFolderOrder(
    key: keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>,
    taskKey: string,
    folderNames: string[]
  ): Promise<void> {
    await this.db.read();

    // 检查任务是否存在
    if (taskKey in this.db.data[key]) {
      const folders = this.db.data[key][taskKey];

      // 创建一个新数组，按照指定的顺序重新排列文件夹
      const newFolders: OrderedFolderItem[] = [];

      // 按照新顺序添加文件夹
      for (const folderName of folderNames) {
        const folder = folders.find(item => item.folderName === folderName);
        if (folder) {
          newFolders.push(folder);
        }
      }

      // 添加那些不在新顺序中的文件夹（保留在末尾）
      for (const folder of folders) {
        if (!folderNames.includes(folder.folderName)) {
          newFolders.push(folder);
        }
      }

      // 更新任务数据
      this.db.data[key][taskKey] = newFolders;

      console.log(`已更新任务 ${taskKey} 的文件夹顺序`);
      console.log(key, this.db.data[key]);
      await this.db.write();
    } else {
      console.warn(`任务 ${taskKey} 不存在`);
    }
  }
}

const workbenchManager = new WorkbenchManager();

export default workbenchManager;

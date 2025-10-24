import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { app } from 'electron';
import { merge, isEqual } from 'lodash-es';
import config from '@config/index';
import { diffArrays, type ArrayDiffResult } from '@main/utils/array';

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
    intervalSeconds: number;
    autoMonitoring: boolean;
    monitoringRunning: boolean;
  };
  s2: {
    autoHandOnWorkflow: boolean;
  };
  s3: {
    productMaterialNum: number;
    storyboardSceneThreshold: number;
    storyboardDuration1: number;
    storyboardDuration2: number;
    autoHandOnWorkflow: boolean;
  };
  /**
   * 第二步任务队列
   */
  s2TasksQueue: string[];
  /**
   * 第三步任务队列
   * {
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
  s3TasksQueue: {
    [key: string]: OrderedVideosChunk;
  };
  /**
   * 第四步任务队列
   */
  s4TasksQueue: string[];
}

// 默认数据
const defaultData: WorkbenchStoreSchema = merge(
  {
    s1: {
      taskDirectory: '',
      materialDuration: 20,
      autoMonitoring: true,
      intervalSeconds: 5,
      monitoringRunning: false,
    },
    s2: {
      autoHandOnWorkflow: true,
    },
    s3: {
      productMaterialNum: 4,
      storyboardSceneThreshold: 0.3,
      storyboardDuration1: 4,
      storyboardDuration2: 6,
      autoHandOnWorkflow: true,
    },
    s2TasksQueue: [],
    s3TasksQueue: {},
    s4TasksQueue: [],
  },
  config.workBenchDefault
);

class WorkbenchManager {
  private db: Low<WorkbenchStoreSchema>;

  // 新增：用于存储观察者
  private watchers: Map<string, Set<(newValue: any, oldValue: any) => void>> =
    new Map();
  // 新增：存储上一次的数据快照
  private previousData: WorkbenchStoreSchema | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = join(userDataPath, 'workbench.json');
    const adapter = new JSONFile<WorkbenchStoreSchema>(dbPath);
    this.db = new Low<WorkbenchStoreSchema>(adapter, defaultData);
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

    // 初始化数据快照
    this.previousData = JSON.parse(JSON.stringify(this.db.data));
  }

  /**
   * 观察数据变化
   * @param key 要观察的键，支持点号分隔的路径（如 's1.taskDirectory'）
   * @param callback 数据变化时的回调函数
   */
  public watch(
    key: string,
    callback: (newValue: any, oldValue: any) => void
  ): void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key)!.add(callback);
  }

  /**
   * 观察数组变化并获取差异信息
   * @param key 要观察的键
   * @param callback 数据变化时的回调函数，包含差异信息
   */
  public watchArray<K extends keyof WorkbenchStoreSchema>(
    key: K,
    callback: (
      diff: ArrayDiffResult<any>,
      newValue: any[],
      oldValue: any[]
    ) => void
  ): void {
    this.watch(key as string, (newValue: any, oldValue: any) => {
      // 确保值是数组
      const newArray = Array.isArray(newValue) ? newValue : [];
      const oldArray = Array.isArray(oldValue) ? oldValue : [];

      // 计算差异
      const diff = diffArrays(newArray, oldArray);

      // 如果有变化，调用回调
      if (diff.hasChanges) {
        callback(diff, newArray, oldArray);
      }
    });
  }

  /**
   * 取消观察
   * @param key 要取消观察的键
   * @param callback 可选，要取消的特定回调函数。如果不提供，则取消该键的所有观察
   */
  public unwatch(
    key: string,
    callback?: (newValue: any, oldValue: any) => void
  ): void {
    if (!this.watchers.has(key)) return;

    if (callback) {
      this.watchers.get(key)!.delete(callback);
      if (this.watchers.get(key)!.size === 0) {
        this.watchers.delete(key);
      }
    } else {
      this.watchers.delete(key);
    }
  }

  /**
   * 检查数据变化并触发观察者
   */
  private checkChanges(): void {
    if (!this.previousData) return;

    // 获取当前数据
    const currentData = this.db.data;

    // 遍历所有观察者
    this.watchers.forEach((callbacks, key) => {
      // 获取新旧值
      const oldValue = this.getValueByPath(this.previousData, key);
      const newValue = this.getValueByPath(currentData, key);

      // 检查值是否变化
      if (!isEqual(oldValue, newValue)) {
        // 触发所有回调
        callbacks.forEach(callback => callback(newValue, oldValue));
      }
    });

    // 更新数据快照
    this.previousData = JSON.parse(JSON.stringify(currentData));
  }

  /**
   * 根据路径获取对象中的值
   * @param obj 目标对象
   * @param path 点号分隔的路径
   */
  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key];
    }, obj);
  }

  /**
   * 获取
   */
  public async getByKey<K extends keyof WorkbenchStoreSchema>(
    key: K
  ): Promise<WorkbenchStoreSchema[K]> {
    await this.db.read();
    console.log(`获取: ${key} ${this.db.data[key]}`);
    return this.db.data[key];
  }

  /**
   * 更新
   */
  public async updateStep<
    K extends keyof Omit<WorkbenchStoreSchema, 's3TasksQueue'>
  >(key: K, sData: WorkbenchStoreSchema[K]): Promise<void> {
    await this.db.read();
    this.db.data[key] = sData;
    console.log(`更新: ${key} ${this.db.data[key]}`);
    await this.db.write();

    // 检查变化并触发观察者
    this.checkChanges();
  }

  /**
   * 新增任务
   */
  public async pushTask(
    key: keyof Pick<
      WorkbenchStoreSchema,
      's2TasksQueue' | 's3TasksQueue' | 's4TasksQueue'
    >,
    taskKey: string,
    taskData?: OrderedVideosChunk
  ): Promise<void> {
    await this.db.read();

    if (key != 's3TasksQueue') this.db.data[key].push(taskKey);
    else {
      if (!taskData) throw new Error('taskData 不能为空');
      this.db.data[key][taskKey] = taskData;
    }

    console.log(`已添加任务: ${taskKey}`);
    await this.db.write();

    // 检查变化并触发观察者
    this.checkChanges();
  }

  /**
   * 删除任务
   */
  public async removeTask(
    key: keyof Pick<
      WorkbenchStoreSchema,
      's2TasksQueue' | 's3TasksQueue' | 's4TasksQueue'
    >,
    taskKey: string
  ): Promise<void> {
    await this.db.read();

    let hasChanges = false;

    // 根据不同的队列类型执行不同的删除操作
    if (key === 's3TasksQueue') {
      // s3TasksQueue 是对象类型，删除属性
      if (taskKey in this.db.data[key]) {
        delete this.db.data[key][taskKey];
        hasChanges = true;
        console.log(`已删除任务: ${taskKey}`);
      } else {
        console.warn(`尝试删除不存在的任务: ${taskKey}`);
      }
    } else {
      // s2TasksQueue 和 s4TasksQueue 是数组类型，移除元素
      const index = this.db.data[key].indexOf(taskKey);
      if (index !== -1) {
        this.db.data[key].splice(index, 1);
        hasChanges = true;
        console.log(`已从 ${key} 中删除任务: ${taskKey}`);
      } else {
        console.warn(`尝试删除不存在的任务: ${taskKey} 在 ${key} 中`);
      }
    }

    // 如果有变化，写入数据库并触发观察者
    if (hasChanges) {
      await this.db.write();
      this.checkChanges();
    }
  }

  /**
   * 查询任务
   */
  public async getTaskByKey(
    key: keyof Pick<WorkbenchStoreSchema, 's3TasksQueue'>,
    taskKey: string
  ): Promise<OrderedVideosChunk | undefined> {
    const data = await this.getByKey(key);
    console.log(`查询任务: ${taskKey}`);
    return data[taskKey];
  }

  /**
   * 添加文件夹到任务
   */
  public async addFolderToTask(
    key: keyof Pick<WorkbenchStoreSchema, 's3TasksQueue'>,
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

    // 检查变化并触发观察者
    this.checkChanges();
  }
}

export default WorkbenchManager;

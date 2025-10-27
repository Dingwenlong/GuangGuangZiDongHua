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
  fragmentDuration: number;
  /**
   * 视频名称
   */
  fileName: string;
  /**
   * 视频编号
   */
  fileNo: number;
}

/**
 * 有序文件夹项
 */
export interface FolderItem {
  /**
   * 文件夹名称
   */
  folderName: string;
  /**
   * 该文件夹下的视频片段列表
   */
  videos: VideoStoryboard[];
}

export type S2VideosChunk = string;

export interface S3VideosChunk {
  /**
   * 去字幕文件
   */
  videoFilePath: string;
  subtitleRemoveOver: boolean;
  pathOfChains: FolderItem[];
}

export interface S4VideosChunk {
  /**
   * 视频文件夹
   */
  folderName: string;
  videos: VideoStoryboard[];
  childFolders?: FolderItem[];
}

// 定义存储的数据结构
export interface WorkbenchStoreSchema {
  s1: {
    taskDirectory?: string;
    materialDuration: number;
    intervalSeconds: number;
    autoMonitoring: boolean;
    running: boolean;
  };
  s2: {
    autoHandOnWorkflow: boolean;
    running: boolean;
  };
  s3s4: {
    productMaterialNum: number;
    storyboardSceneThreshold: number;
    storyboardDuration1: number;
    storyboardDuration2: number;
    autoHandOnWorkflow: boolean;
    running: boolean;
  };
  /**
   * 第二步任务队列
   */
  s2TasksQueue: string[];
  /**
   * 第三步任务队列
    [
      {
        videoFileName: 'C://任务目录/去字幕任务/商品1.mp4',
        subtitleRemoveOver: false,
        pathOfChains: [
          {
            folderName: '商品文件夹1',
            videos: [{fragmentDuration: 20, fileName: '1.mp4'}, ...3],
          },
          {
            folderName: '商品文件夹2',
            videos: [{fragmentDuration: 20, fileName: '3.mp4'}, ...3],
          }
        ]
      }
    ]
   */
  s3TasksQueue: S3VideosChunk[];
  /**
   * 第四步任务队列
    [
      {
        folderName: 'C://任务目录/商品1文件夹',
        videos: [{fragmentDuration: 20, fileName: '1.mp4'}, ...3],
        childFolders?: [
          {
            folderName: 'C://任务目录/视频分镜任务/子商品文件夹1',
            videos: [{fragmentDuration: 20, fileName: '1.mp4'}, ...3]
          },
          ...3
        ]
      }
    ]
   */
  s4TasksQueue: S4VideosChunk[];
}

// 默认数据
const defaultData: WorkbenchStoreSchema = merge(
  {
    s1: {
      taskDirectory: '',
      materialDuration: 20,
      autoMonitoring: true,
      intervalSeconds: 5,
      running: false,
    },
    s2: {
      autoHandOnWorkflow: true,
      running: false,
    },
    s3s4: {
      productMaterialNum: 4,
      storyboardSceneThreshold: 0.3,
      storyboardDuration1: 4,
      storyboardDuration2: 6,
      autoHandOnWorkflow: true,
      running: false,
    },
    s2TasksQueue: [],
    s3TasksQueue: [],
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
    console.log(`获取: ${key} ${JSON.stringify(this.db.data[key])}`);
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
    console.log(`更新: ${key} ${JSON.stringify(this.db.data[key])}`);
    await this.db.write();

    // 检查变化并触发观察者
    this.checkChanges();
  }

  /**
   * 将任务入列
   */
  public async enqueueTask(
    key: keyof Pick<
      WorkbenchStoreSchema,
      's2TasksQueue' | 's3TasksQueue' | 's4TasksQueue'
    >,
    data: string | S3VideosChunk | S4VideosChunk
  ): Promise<void> {
    await this.db.read();

    if (key === 's2TasksQueue') {
      this.db.data[key].push(data as string);
    }
    if (key === 's3TasksQueue') {
      this.db.data[key].push(data as S3VideosChunk);
    }
    if (key === 's4TasksQueue') {
      this.db.data[key].push(data as S4VideosChunk);
    }

    console.log(`已添加任务: ${data}`);
    await this.db.write();

    // 检查变化并触发观察者
    this.checkChanges();
  }

  /**
   * 队列任务移除（先进先出）
   * @param key 队列键名
   * @returns 返回被移除的任务，如果队列为空则返回 undefined
   */
  public async dequeueTask(
    key: keyof Pick<
      WorkbenchStoreSchema,
      's2TasksQueue' | 's3TasksQueue' | 's4TasksQueue'
    >
  ): Promise<S2VideosChunk | S3VideosChunk | S4VideosChunk | undefined> {
    await this.db.read();

    // 检查队列是否为空
    if (this.db.data[key].length === 0) {
      return undefined;
    }

    let array = this.db.data[key];
    let removedTask: S2VideosChunk | S3VideosChunk | S4VideosChunk | undefined;

    if (key === 's3TasksQueue') {
      // 找到第一个字幕处理完的任务
      const index = (array as S3VideosChunk[]).findIndex(
        x => x.subtitleRemoveOver
      );

      if (index !== -1) {
        // 从原始队列中移除该任务
        removedTask = array.splice(index, 1)[0];
      }
    } else {
      // 其他队列直接移除第一个元素（先进先出）
      removedTask = array.shift();
    }

    if (removedTask) {
      console.log(`已从 ${key} 中移除任务:`, removedTask);
      await this.db.write();

      // 检查变化并触发观察者
      this.checkChanges();
    }

    return removedTask;
  }

  /**
   * 根据视频文件路径更新字幕处理状态
   * @param videoFilePath 视频文件路径
   * @param subtitleRemoveOver 新的字幕处理状态
   * @returns 是否成功更新
   */
  public async updateSubtitleRemoveOver(
    videoFilePath: string,
    subtitleRemoveOver: boolean
  ): Promise<boolean> {
    await this.db.read();

    // 查找匹配的任务
    const taskIndex = this.db.data.s3TasksQueue.findIndex(
      task => task.videoFilePath === videoFilePath
    );

    if (taskIndex === -1) {
      console.warn(`未找到视频路径为 ${videoFilePath} 的任务`);
      return false;
    }

    // 更新状态
    const oldStatus = this.db.data.s3TasksQueue[taskIndex].subtitleRemoveOver;
    this.db.data.s3TasksQueue[taskIndex].subtitleRemoveOver =
      subtitleRemoveOver;

    console.log(
      `更新字幕处理状态: ${videoFilePath} ${oldStatus} -> ${subtitleRemoveOver}`
    );

    await this.db.write();

    // 检查变化并触发观察者
    this.checkChanges();

    return true;
  }
}

export default WorkbenchManager;

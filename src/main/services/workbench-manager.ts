import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { app } from 'electron';
import { merge, isEqual } from 'lodash-es';
import config from '@config/index';
import { diffArrays, type ArrayDiffResult } from '@main/utils/array';
import { sqInsert, sqQuery, sqUpdate } from '../lib/sqllite3';

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
  s5: {
    autoHandOnWorkflow: boolean;
    running: boolean;
  };
  s6: {
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
  /**
   * 第五步任务队列
   */
  s5TasksQueue: string[];
  /**
   * 第六步任务队列
   */
  s6TasksQueue: string[];
}

type WorkbenchConfigStoreSchema = Omit<
  WorkbenchStoreSchema,
  | 's2TasksQueue'
  | 's3TasksQueue'
  | 's4TasksQueue'
  | 's5TasksQueue'
  | 's6TasksQueue'
>;

type WorkbenchQueuesStoreSchema = Pick<
  WorkbenchStoreSchema,
  | 's2TasksQueue'
  | 's3TasksQueue'
  | 's4TasksQueue'
  | 's5TasksQueue'
  | 's6TasksQueue'
>;

// 默认数据
const defaultData: WorkbenchConfigStoreSchema = merge(
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
      running: true,
    },
    s5: {
      autoHandOnWorkflow: true,
      running: false,
    },
    s6: {
      autoHandOnWorkflow: true,
      running: false,
    },
  },
  config.workBenchDefault
);

// 任务状态枚举
export enum WorkbenchTaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

class WorkbenchManager {
  private db: Low<WorkbenchConfigStoreSchema>;

  // 新增：用于存储观察者
  private watchers: Map<string, Set<(newValue: any, oldValue: any) => void>> =
    new Map();
  // 新增：存储上一次的数据快照
  private previousData: WorkbenchStoreSchema | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = join(userDataPath, 'workbench.json');
    const adapter = new JSONFile<WorkbenchConfigStoreSchema>(dbPath);
    this.db = new Low<WorkbenchConfigStoreSchema>(adapter, defaultData);
    this.init();
  }

  /**
   * 初始化数据库
   */
  private async init(): Promise<void> {
    // 初始化lowdb
    await this.db.read();

    // 如果数据为空，则设置默认值
    if (!this.db.data) {
      this.db.data = defaultData;
      await this.db.write();
    }

    // 初始化数据快照
    this.previousData = JSON.parse(JSON.stringify(this.db.data));

    // 初始化SQLite3
    await this.initializeSchema();
  }

  /**
   * 重写initializeSchema方法，创建队列相关的表
   */
  private async initializeSchema(): Promise<void> {
    try {
      // 创建s2任务队列表
      await sqQuery({
        sql: `
          CREATE TABLE IF NOT EXISTS s2_tasks_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_data TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
      });

      // 创建s3任务队列表
      await sqQuery({
        sql: `
          CREATE TABLE IF NOT EXISTS s3_tasks_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_file_path TEXT NOT NULL,
            subtitle_remove_over INTEGER NOT NULL DEFAULT 0,
            path_of_chains TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
      });

      // 创建s4任务队列表
      await sqQuery({
        sql: `
          CREATE TABLE IF NOT EXISTS s4_tasks_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_name TEXT NOT NULL,
            videos TEXT NOT NULL,
            child_folders TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
      });

      // 创建s5任务队列表
      await sqQuery({
        sql: `
          CREATE TABLE IF NOT EXISTS s5_tasks_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_data TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
      });

      // 创建s6任务队列表
      await sqQuery({
        sql: `
          CREATE TABLE IF NOT EXISTS s6_tasks_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_data TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
      });

      console.log('Queue database schema initialized.');
    } catch (err) {
      console.error('Error initializing queue database schema:', err);
      throw err;
    }
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
  public async getByKey<K extends keyof WorkbenchConfigStoreSchema>(
    key: K
  ): Promise<WorkbenchConfigStoreSchema[K]> {
    await this.db.read();
    console.log(`获取: ${key} ${JSON.stringify(this.db.data[key])}`);
    return this.db.data[key];
  }

  /**
   * 将任务入列
   */
  public async enqueueTask(
    key: keyof WorkbenchQueuesStoreSchema,
    data: string | string[] | S3VideosChunk | S4VideosChunk
  ): Promise<void> {
    const now = Date.now();

    try {
      if (key === 's2TasksQueue') {
        await sqInsert({
          table: 's2_tasks_queue',
          data: {
            task_data: data as string,
            status: WorkbenchTaskStatus.PENDING,
            created_at: now,
            updated_at: now,
          },
        });
      } else if (key === 's3TasksQueue') {
        const itemsToAdd = Array.isArray(data) ? data : [data];
        for (const item of itemsToAdd) {
          const taskData = item as S3VideosChunk;
          await sqInsert({
            table: 's3_tasks_queue',
            data: {
              video_file_path: taskData.videoFilePath,
              subtitle_remove_over: taskData.subtitleRemoveOver ? 1 : 0,
              path_of_chains: JSON.stringify(taskData.pathOfChains),
              status: WorkbenchTaskStatus.PENDING,
              created_at: now,
              updated_at: now,
            },
          });
        }
      } else if (key === 's4TasksQueue') {
        const itemsToAdd = Array.isArray(data) ? data : [data];
        for (const item of itemsToAdd) {
          const taskData = item as S4VideosChunk;
          await sqInsert({
            table: 's4_tasks_queue',
            data: {
              folder_name: taskData.folderName,
              videos: JSON.stringify(taskData.videos),
              child_folders: taskData.childFolders
                ? JSON.stringify(taskData.childFolders)
                : null,
              status: WorkbenchTaskStatus.PENDING,
              created_at: now,
              updated_at: now,
            },
          });
        }
      } else if (key === 's5TasksQueue') {
        const itemsToAdd = Array.isArray(data) ? data : [data];
        for (const item of itemsToAdd) {
          await sqInsert({
            table: 's5_tasks_queue',
            data: {
              task_data: item as string,
              status: WorkbenchTaskStatus.PENDING,
              created_at: now,
              updated_at: now,
            },
          });
        }
      } else if (key === 's6TasksQueue') {
        const itemsToAdd = Array.isArray(data) ? data : [data];
        for (const item of itemsToAdd) {
          await sqInsert({
            table: 's6_tasks_queue',
            data: {
              task_data: item as string,
              status: WorkbenchTaskStatus.PENDING,
              created_at: now,
              updated_at: now,
            },
          });
        }
      }
    } catch (error) {
      console.error(`添加任务到 ${key} 失败:`, error);
      throw error;
    }
  }

  /**
   * 队列任务移除（先进先出）
   * @param key 队列键名
   * @returns 返回被移除的任务，如果队列为空则返回 undefined
   */
  public async dequeueTask(
    key: keyof Pick<
      WorkbenchStoreSchema,
      | 's2TasksQueue'
      | 's3TasksQueue'
      | 's4TasksQueue'
      | 's5TasksQueue'
      | 's6TasksQueue'
    >
  ): Promise<
    | [S2VideosChunk, number]
    | [S3VideosChunk, number]
    | [S4VideosChunk, number]
    | undefined
  > {
    try {
      let tableName = '';
      let task: any;

      switch (key) {
        case 's2TasksQueue':
          tableName = 's2_tasks_queue';
          break;
        case 's3TasksQueue':
          tableName = 's3_tasks_queue';
          break;
        case 's4TasksQueue':
          tableName = 's4_tasks_queue';
          break;
        case 's5TasksQueue':
          tableName = 's5_tasks_queue';
          break;
        case 's6TasksQueue':
          tableName = 's6_tasks_queue';
          break;
      }

      if (key === 's3TasksQueue') {
        // 找到第一个字幕处理完的任务
        const rows = await sqQuery({
          sql: `SELECT * FROM ${tableName} WHERE status = ? AND subtitle_remove_over = ? ORDER BY created_at ASC LIMIT 1`,
          params: [WorkbenchTaskStatus.PENDING, 1],
        });

        if (rows.length > 0) {
          task = rows[0];

          // 更新任务状态为处理中
          await sqUpdate({
            table: tableName,
            data: {
              status: WorkbenchTaskStatus.PROCESSING,
              updated_at: Date.now(),
            },
            condition: `id = ${task.id}`,
          });

          // 转换为S3VideosChunk格式
          return [
            {
              videoFilePath: task.video_file_path,
              subtitleRemoveOver: task.subtitle_remove_over === 1,
              pathOfChains: JSON.parse(task.path_of_chains),
            } as S3VideosChunk,
            task.id,
          ];
        }
      } else {
        // 其他队列直接获取第一个元素（先进先出）
        const rows = await sqQuery({
          sql: `SELECT * FROM ${tableName} WHERE status = ? ORDER BY created_at ASC LIMIT 1`,
          params: [WorkbenchTaskStatus.PENDING],
        });

        if (rows.length > 0) {
          task = rows[0];

          // 更新任务状态为处理中
          await sqUpdate({
            table: tableName,
            data: {
              status: WorkbenchTaskStatus.PROCESSING,
              updated_at: Date.now(),
            },
            condition: `id = ${task.id}`,
          });

          // 根据不同队列类型返回不同格式的数据
          if (
            key === 's2TasksQueue' ||
            key === 's5TasksQueue' ||
            key === 's6TasksQueue'
          ) {
            return [task.task_data as string, task.id];
          } else if (key === 's4TasksQueue') {
            return [
              {
                folderName: task.folder_name,
                videos: JSON.parse(task.videos),
                childFolders: task.child_folders
                  ? JSON.parse(task.child_folders)
                  : undefined,
              } as S4VideosChunk,
              task.id,
            ];
          }
        }
      }

      return undefined;
    } catch (error) {
      console.error(`从 ${key} 中移除任务失败:`, error);
      throw error;
    }
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
    try {
      // 查找匹配的任务
      const rows = await sqQuery({
        sql: `SELECT * FROM s3_tasks_queue WHERE video_file_path = ?`,
        params: [videoFilePath],
      });

      if (rows.length === 0) {
        console.warn(`未找到视频路径为 ${videoFilePath} 的任务`);
        return false;
      }

      const task = rows[0];
      const oldStatus = task.subtitle_remove_over === 1;

      // 更新状态
      await sqUpdate({
        table: 's3_tasks_queue',
        data: {
          subtitle_remove_over: subtitleRemoveOver ? 1 : 0,
          updated_at: Date.now(),
        },
        condition: `id = ${task.id}`,
      });

      console.log(
        `更新字幕处理状态: ${videoFilePath} ${oldStatus} -> ${subtitleRemoveOver}`
      );

      return true;
    } catch (error) {
      console.error(`更新字幕处理状态失败:`, error);
      return false;
    }
  }

  /**
   * 更新
   */
  public async updateStep<K extends keyof WorkbenchConfigStoreSchema>(
    key: K,
    sData: WorkbenchConfigStoreSchema[K]
  ): Promise<void> {
    await this.db.read();
    this.db.data[key] = sData;
    console.log(`更新: ${key} ${JSON.stringify(this.db.data[key])}`);
    await this.db.write();

    // 检查变化并触发观察者
    this.checkChanges();
  }

  /**
   * 获取队列中的所有任务
   * @param key 队列键名
   * @returns 返回队列中的所有任务
   */
  public async getAllTasks(
    key: keyof Pick<
      WorkbenchStoreSchema,
      | 's2TasksQueue'
      | 's3TasksQueue'
      | 's4TasksQueue'
      | 's5TasksQueue'
      | 's6TasksQueue'
    >
  ): Promise<any[]> {
    try {
      let tableName = '';

      switch (key) {
        case 's2TasksQueue':
          tableName = 's2_tasks_queue';
          break;
        case 's3TasksQueue':
          tableName = 's3_tasks_queue';
          break;
        case 's4TasksQueue':
          tableName = 's4_tasks_queue';
          break;
        case 's5TasksQueue':
          tableName = 's5_tasks_queue';
          break;
        case 's6TasksQueue':
          tableName = 's6_tasks_queue';
          break;
      }

      const rows = await sqQuery({
        sql: `SELECT * FROM ${tableName} ORDER BY created_at ASC`,
        params: [],
      });

      // 根据不同队列类型转换数据格式
      if (
        key === 's2TasksQueue' ||
        key === 's5TasksQueue' ||
        key === 's6TasksQueue'
      ) {
        return rows.map((row: any) => row.task_data);
      } else if (key === 's3TasksQueue') {
        return rows.map((row: any) => ({
          videoFilePath: row.video_file_path,
          subtitleRemoveOver: row.subtitle_remove_over === 1,
          pathOfChains: JSON.parse(row.path_of_chains),
        }));
      } else if (key === 's4TasksQueue') {
        return rows.map((row: any) => ({
          folderName: row.folder_name,
          videos: JSON.parse(row.videos),
          childFolders: row.child_folders
            ? JSON.parse(row.child_folders)
            : undefined,
        }));
      }

      return [];
    } catch (error) {
      console.error(`获取 ${key} 中的所有任务失败:`, error);
      return [];
    }
  }

  /**
   * 更新任务状态
   * @param key 队列键名
   * @param taskId 任务ID
   * @param status 新状态
   */
  public async updateTaskStatus(
    key: keyof Pick<
      WorkbenchStoreSchema,
      | 's2TasksQueue'
      | 's3TasksQueue'
      | 's4TasksQueue'
      | 's5TasksQueue'
      | 's6TasksQueue'
    >,
    taskId: number,
    status: WorkbenchTaskStatus
  ): Promise<boolean> {
    try {
      let tableName = '';

      switch (key) {
        case 's2TasksQueue':
          tableName = 's2_tasks_queue';
          break;
        case 's3TasksQueue':
          tableName = 's3_tasks_queue';
          break;
        case 's4TasksQueue':
          tableName = 's4_tasks_queue';
          break;
        case 's5TasksQueue':
          tableName = 's5_tasks_queue';
          break;
        case 's6TasksQueue':
          tableName = 's6_tasks_queue';
          break;
      }

      await sqUpdate({
        table: tableName,
        data: {
          status: status,
          updated_at: Date.now(),
        },
        condition: `id = ${taskId}`,
      });

      return true;
    } catch (error) {
      console.error(`更新任务状态失败:`, error);
      return false;
    }
  }
}

export default new WorkbenchManager();

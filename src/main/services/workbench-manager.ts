import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { app } from 'electron';

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
  // { '视频路径': ['片段1'，'片段2'] }
  subtitleRemoveRunningTasks: {
    [key: string]: string[][];
  }[];
}

// 默认数据
const defaultData: WorkbenchStoreSchema = {
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
  subtitleRemoveRunningTasks: [],
};

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
  public async getInfo<K extends keyof WorkbenchStoreSchema>(
    stepNo: K
  ): Promise<WorkbenchStoreSchema[K]> {
    await this.db.read();
    console.log(stepNo, this.db.data[stepNo]);
    return this.db.data[stepNo];
  }

  /**
   * 更新信息
   */
  public async updateData<
    K extends keyof Omit<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>
  >(stepNo: K, sData: WorkbenchStoreSchema[K]): Promise<void> {
    await this.db.read();
    this.db.data[stepNo] = sData;
    console.log(stepNo, this.db.data[stepNo]);
    await this.db.write();
  }

  /**
   * 新增任务
   */
  public async pushTask<
    K extends keyof Pick<WorkbenchStoreSchema, 'subtitleRemoveRunningTasks'>
  >(key: K, sData: WorkbenchStoreSchema[K][number]): Promise<void> {
    await this.db.read();
    this.db.data[key] = [...this.db.data[key], sData];
    console.log(key, this.db.data[key]);
    await this.db.write();
  }
}

const workbenchManager = new WorkbenchManager();

export default workbenchManager;

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { app } from 'electron';

// 定义存储的数据结构
export interface WorkbenchStoreSchema {
  taskDirectory?: string,
  materialDuration: number,
  autoMonitoring: boolean,
  intervalSeconds: number
}

// 默认数据
const defaultData: WorkbenchStoreSchema = {
  taskDirectory: '',
  materialDuration: 20,
  autoMonitoring: true,
  intervalSeconds: 5
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
   * @returns {Promise<WorkbenchData | null>} 数据
   */
  public async getInfo(): Promise<WorkbenchStoreSchema | null> {
    await this.db.read();
    return this.db.data;
  }

  /**
   * 更新信息
   * @param {Partial<WorkbenchData>} workbenchData - 数据
   */
  public async updateData(workbenchData: WorkbenchStoreSchema): Promise<void> {
    await this.db.read();
    this.db.data = workbenchData;
    await this.db.write();
  }
}

const workbenchManager = new WorkbenchManager();

export default workbenchManager;

import FileWatcher from '@main/lib/file-watcher';
import { sqInsert, sqQuery } from '@main/lib/sqllite3';
import { writeLog, type LogEvent } from '@main/utils/log';
import EventEmitter from 'events';
import * as fs from 'fs';
import path from 'path';

/**
 * 光合账号
 */
interface GuangHeAccount {
  /**
   * 昵称
   */
  nickname: string;
  /**
   * 类目
   */
  category: string;
  /**
   * 逛逛号Id
   */
  guangId: string;
}

/**
 * 光和发布记录表结构
 */
interface GuangPublishRecordSchema extends GuangHeAccount {
  /**
   * 发布的文件的路径
   */
  filePath: string;
}

/**
 * 逛逛账号文件夹
 */
interface GuangHePublishRecord extends GuangHeAccount {
  folderName: string;
  dirPath: string;
  count: number;
  filePathArray: string[];
}

export class GuangProcessor extends EventEmitter {
  private watcher: FileWatcher | null;

  // 光合发布今日记录
  private GuangHePublishRecordByToday: GuangHePublishRecord[] = [];

  constructor() {
    super();
    this.watcher = null;
  }

  public start(monitorDirectory: string): void {
    if (!fs.existsSync(monitorDirectory)) {
      this.writeLog('监控目录不存在', 'error');
      return;
    }

    this.initializeSchema();
    this.startFileWatching(monitorDirectory);
  }

  private startFileWatching(monitorDirectory: string): void {
    this.watcher = new FileWatcher(monitorDirectory, {
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        /.*---\d+\.mp4$/, // 忽略已处理的视频文件
        /temp/, // 忽略临时目录
      ],
      depth: 2, // 监控深度增加到3层
      ignoreInitial: false, // 不忽略初始文件
      awaitWriteFinish: {
        stabilityThreshold: 3000, // 文件稳定3秒后才触发
        pollInterval: 500,
      },
      interval: 2000, // 轮询间隔
      binaryInterval: 3000,
    });

    this.watcher
      .on('add', (filePath: string) => this.handleFileEvent(filePath, 'add'))
      .on('change', (filePath: string) =>
        this.handleFileEvent(filePath, 'change')
      )
      .on('unlink', (filePath: string) =>
        this.handleFileEvent(filePath, 'unlink')
      )
      .on('ready', () => {
        this.writeLog('光合发布文件监控系统就绪', 'success');
      })
      .on('error', (error: Error) => {
        this.writeLog(`文件监控错误: ${error.message}`, 'error');
      });

    this.watcher.start();
  }

  public stop(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
      this.writeLog('已停止光合发布文件监控', 'info');
    }
  }

  /**
   * 处理文件事件
   */
  private async handleFileEvent(
    filePath: string,
    eventType: string
  ): Promise<void> {
    try {
      this.writeLog(`${eventType}文件:${path.basename(filePath)}`);
      if (eventType === 'add') {
        // || eventType === 'change'
        const fileName = path.basename(filePath);
        const [name, category, guangId, day, number] = fileName.split('---');
        await this.publishGuangHe(filePath);
      }
    } catch (error) {
      this.writeLog(
        `处理文件${eventType}事件失败: ${path.basename(filePath)} - ${
          (error as Error).message
        }`,
        'error'
      );
    }
  }

  private findLowestGuangHeAccount(): GuangPublishRecordSchema | null {
    // todo 查找发布量最少的光和账号逻辑...
    return null;
  }

  private async publishGuangHe(filePath: string): Promise<void> {
    // todo 光和平台逻辑代码...

    // 发布完成后
    const now = Date.now();
    await sqInsert({
      table: 's7_publish_record',
      data: {
        nickname: '',
        category: '',
        guangId: '',
        created_at: now,
        updated_at: now,
      },
    });
  }

  private async initializeSchema(): Promise<void> {
    try {
      // 创建s7发布记录表
      await sqQuery({
        sql: `
            CREATE TABLE IF NOT EXISTS s7_publish_record (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nickname TEXT NOT NULL,
              category TEXT NOT NULL,
              guangId TEXT NOT NULL,
              filePath TEXT NOT NULL,
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

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}

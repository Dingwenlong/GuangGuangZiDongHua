import FileWatcher from '@main/lib/file-watcher';
import { sqInsert, sqQuery } from '@main/lib/sqllite3';
import { cutFileToOtherDirectory } from '@main/utils/file';
import { writeLog, type LogEvent } from '@main/utils/log';
import dayjs from 'dayjs';
import EventEmitter from 'events';
import * as fs from 'fs';
import path from 'path';

// 发布状态枚举
export enum GuangHePublishStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class GuangProcessor extends EventEmitter {
  private accountDirectory: string = '';
  private watcher: FileWatcher | null;
  //0:停止 1:运行中 2:启动中 3:停止中
  private runningStatus: number = 0;

  constructor() {
    super();
    this.watcher = null;
  }

  public startMonitor(monitorDirectory: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        if (this.runningStatus !== 0)
          return reject('视频分发文件监控未停止，无法启动');

        if (!fs.existsSync(monitorDirectory)) {
          this.writeLog('监控目录不存在', 'error');
          return reject('监控目录不存在');
        }

        this.initializeSchema();
        this.startFileWatching(monitorDirectory);
        setTimeout(() => {
          this.runningStatus = 1;
          this.writeLog(
            `已启动光合发布文件监控，监控目录: ${monitorDirectory}`,
            'success'
          );
          resolve();
        }, 3000);
      } catch (error) {
        reject(error);
      }
    });
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
        this.writeLog('视频分发文件监控系统就绪', 'success');

        // 扫描现有文件
        setTimeout(() => this.scanExistingFiles(), 5000);
      })
      .on('error', (error: Error) => {
        this.writeLog(`文件监控错误: ${error.message}`, 'error');
      });

    this.watcher.start();
  }

  public stopMonitor(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        if (this.runningStatus !== 1) return reject('视频分发文件监控未在运行');

        this.runningStatus = 3;
        if (this.watcher) {
          this.watcher.stop();
          this.watcher = null;
          this.writeLog('已停止光合发布文件监控', 'success');
        }
        setTimeout(() => {
          this.runningStatus = 0;
          resolve();
        }, 3000);
      } catch (error) {
        reject(error);
      }
    });
  }

  // 扫描现有文件
  private async scanExistingFiles(): Promise<void> {
    this.writeLog('开始扫描现有文件');
    const items = fs.readdirSync(this.watcher!.getPath());
    for (const file of items) {
      await this.handleFileEvent(
        path.join(this.watcher!.getPath(), file),
        'scan'
      );
    }
    this.writeLog(`扫描完成，发现 ${items.length} 个待处理文件`);
  }

  /**
   * 处理文件事件
   */
  private async handleFileEvent(
    filePath: string,
    eventType: string
  ): Promise<void> {
    try {
      this.writeLog(`${eventType}文件:${filePath}`);
      if (
        eventType === 'add' ||
        eventType === 'change' ||
        eventType === 'scan'
      ) {
        const fileName = path.basename(filePath);
        // 解析S6视频文件名提取{类目}信息
        const [step, no, productTitle, category, productId, ...rest] =
          fileName.split('---');
        if (step !== 'S6' || !category || !productId) {
          this.writeLog(
            `文件${eventType}处理失败: ${fileName}，文件名格式不正确`,
            'error'
          );
          return;
        }

        // 寻找可用逛逛账号
        const accountDirPath = this.getGuangHeAccount(category);
        if (!accountDirPath) {
          this.writeLog(
            `文件${eventType}处理失败: ${fileName}，暂无可用逛逛账号`,
            'warning'
          );
          return;
        }
        const dirPath = path.dirname(accountDirPath);
        const dirName = path.basename(accountDirPath);

        // 剪切视频到目标账号目录
        this.writeLog(`${fileName}剪切视频到${accountDirPath}目录`);
        await cutFileToOtherDirectory(filePath, accountDirPath, fileName);

        // 重命名 目标账号目录 {逛逛昵称}---{类目}---{ID}---{日期}---{计数};
        const dirParts = dirName.split('---');
        const [nickname, _, guangId, date, count] = dirParts;
        this.writeLog(`重命名${dirName}目录`);
        await fs.promises.rename(
          accountDirPath,
          path.join(
            dirPath,
            [...dirParts.slice(0, 3), date, ~~count + 1].join('---')
          )
        );
        // 插入发布记录表
        await this.insertPublishGuangHeRecord(
          nickname,
          category,
          guangId,
          path.join(accountDirPath, fileName),
          GuangHePublishStatus.PENDING
        );
        this.writeLog(
          `文件${eventType}处理完成: ${path.basename(filePath)}`,
          'success'
        );
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

  private getGuangHeAccount(category: string): string | null {
    if (!this.accountDirectory) return null;

    // 条件: 类目匹配 + 当天 + 计数 < 3 + 计数最小;
    const [smallestItem] = fs
      .readdirSync(this.accountDirectory)
      .filter(item => {
        const fullPath = path.join(this.accountDirectory, item);
        return fs.statSync(fullPath).isDirectory();
      })
      .filter(item => item.includes(`---${category}---`))
      .filter(
        item =>
          item.includes(`---${dayjs().format('YYYY-MM-DD')}---`) ||
          item.includes(`---${dayjs().add(-1, 'd').format('YYYY-MM-DD')}---`) ||
          item.includes(`---${dayjs().add(-2, 'd').format('YYYY-MM-DD')}---`)
      )
      .filter(
        item =>
          item.includes('---0') ||
          item.includes('---1') ||
          item.includes('---2')
      )
      .sort((a, b) => {
        const aParts = a.split('---');
        const bParts = b.split('---');
        const aCount = parseInt(aParts[4], 10);
        const bCount = parseInt(bParts[4], 10);
        return aCount - bCount;
      })
      .map(item => path.join(this.accountDirectory, item));

    return smallestItem;
  }

  public setAccountDirectory(dir: string): void {
    this.accountDirectory = dir;
  }

  /**
   * 插入光合发布记录
   * @param nickname
   * @param category
   * @param guangId
   */
  public async insertPublishGuangHeRecord(
    nickname: string,
    category: string,
    guangId: string,
    filePath: string,
    status: GuangHePublishStatus = GuangHePublishStatus.PENDING
  ): Promise<void> {
    const now = Date.now();
    await sqInsert({
      table: 's7_publish_record',
      data: {
        nickname: nickname,
        category: category,
        guangId: guangId,
        filePath: filePath,
        status: status,
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

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}

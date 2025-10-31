import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import FileWatcher from '../lib/file-watcher';
import { isVideoFile, isProcessedVideoFile } from '../utils/file';

interface DirectoryItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number; // 文件大小（字节）
  children?: DirectoryItem[]; // 子目录内容
  isVideo?: boolean; // 是否是视频文件
  isProcessed?: boolean; // 是否是已处理的视频
}

interface DirectoryMonitorEvents {
  directoryStructure: {
    root: string;
    structure: DirectoryItem[];
  };
  log: {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'debug';
  };
}

declare interface DirectoryMonitor {
  on<K extends keyof DirectoryMonitorEvents>(
    event: K,
    listener: (arg: DirectoryMonitorEvents[K]) => void
  ): this;
  emit<K extends keyof DirectoryMonitorEvents>(
    event: K,
    arg: DirectoryMonitorEvents[K]
  ): boolean;
}

class DirectoryMonitor extends EventEmitter {
  public monitorDirectory: string;
  private watcher: FileWatcher | null;
  private updateInterval: NodeJS.Timeout | null;
  private maxDepth: number;
  private debounceTimer: NodeJS.Timeout | null;
  private debounceDelay: number;
  private isDestroyed: boolean = false;

  constructor(
    monitorDirectory: string,
    options: {
      maxDepth?: number;
      updateInterval?: number;
      debounceDelay?: number;
    } = {}
  ) {
    super();
    this.monitorDirectory = monitorDirectory;
    this.watcher = null;
    this.updateInterval = null;
    this.debounceTimer = null;

    // 配置选项
    this.maxDepth = options.maxDepth ?? 3;
    this.debounceDelay = options.debounceDelay ?? 500;
  }

  /**
   * 启动目录监控
   */
  start(): void {
    if (!this.monitorDirectory || !fs.existsSync(this.monitorDirectory)) {
      this.emit('log', { message: '监控目录不存在', type: 'error' });
      return;
    }

    // 启动文件监控
    this.startFileWatching();

    // 定期更新目录结构
    this.updateInterval = setInterval(() => {
      this.emitDirectoryStructure();
    }, 30000);

    // 初始发送目录结构
    this.emitDirectoryStructure();

    this.emit('log', {
      message: `目录监控已启动，监控目录: ${this.monitorDirectory}`,
      type: 'success',
    });
  }

  /**
   * 停止目录监控
   */
  stop(): void {
    if (this.isDestroyed) return;

    this.cleanupResources();
    this.emit('log', { message: '目录监控已完全停止', type: 'info' });
  }

  private cleanupResources(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;

    if (this.watcher) {
      // 移除所有事件监听器
      this.watcher.removeAllListeners();
      this.watcher.stop();
      this.watcher = null;
    }

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.removeAllListeners();
  }

  /**
   * 启动文件监控
   */
  private startFileWatching(): void {
    this.watcher = new FileWatcher(this.monitorDirectory, {
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        /node_modules/,
      ],
      depth: this.maxDepth,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', () => this.scheduleUpdate())
      .on('change', () => this.scheduleUpdate())
      .on('unlink', () => this.scheduleUpdate())
      .on('addDir', () => this.scheduleUpdate())
      .on('unlinkDir', () => this.scheduleUpdate())
      .on('ready', () => {
        this.emit('log', { message: '目录监控系统就绪', type: 'success' });
      })
      .on('error', (error: Error) => {
        this.emit('log', {
          message: `目录监控错误: ${error.message}, ${this.monitorDirectory}`,
          type: 'error',
        });
      });

    this.watcher.start();
  }

  /**
   * 防抖更新目录结构
   */
  private scheduleUpdate(): void {
    if (this.isDestroyed) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      this.emitDirectoryStructure();
    }, this.debounceDelay);
  }

  /**
   * 发送目录结构事件
   */
  private emitDirectoryStructure(): void {
    if (this.isDestroyed) return;

    try {
      const structure = this.getDirectoryStructure(this.monitorDirectory);
      this.emit('directoryStructure', {
        root: this.monitorDirectory,
        structure,
      });
    } catch (error) {
      if (!this.isDestroyed) {
        this.emit('log', {
          message: `发送目录结构失败: ${(error as Error).message}`,
          type: 'error',
        });
      }
    }
  }

  /**
   * 获取目录结构
   */
  private getDirectoryStructure(
    dirPath: string,
    currentDepth: number = 0
  ): DirectoryItem[] {
    if (this.isDestroyed) return [];

    const items: DirectoryItem[] = [];

    try {
      if (!fs.existsSync(dirPath)) {
        if (!this.isDestroyed) {
          this.emit('log', {
            message: `目录不存在: ${dirPath}`,
            type: 'warning',
          });
        }
        return [];
      }

      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        try {
          const fullPath = path.join(dirPath, file);
          const stats = fs.statSync(fullPath);

          if (stats.isDirectory()) {
            // 递归获取子目录内容，限制深度
            const children =
              currentDepth < this.maxDepth
                ? this.getDirectoryStructure(fullPath, currentDepth + 1)
                : [];

            items.push({
              name: file,
              path: fullPath,
              type: 'directory',
              children,
            });
          } else {
            // 判断是否是视频文件
            const isVideo = isVideoFile(fullPath);
            const isProcessed = isVideo && isProcessedVideoFile(fullPath);

            items.push({
              name: file,
              path: fullPath,
              type: 'file',
              size: stats.size,
              isVideo,
              isProcessed,
            });
          }
        } catch (fileError) {
          if (!this.isDestroyed) {
            this.emit('log', {
              message: `处理文件失败: ${file} - ${
                (fileError as Error).message
              }`,
              type: 'warning',
            });
          }
        }
      }
    } catch (error) {
      if (!this.isDestroyed) {
        this.emit('log', {
          message: `读取目录失败: ${dirPath} - ${(error as Error).message}`,
          type: 'error',
        });
      }
    }

    return items;
  }

  /**
   * 手动获取当前目录结构
   */
  getCurrentStructure(): DirectoryItem[] {
    return this.getDirectoryStructure(this.monitorDirectory);
  }
}

export default DirectoryMonitor;

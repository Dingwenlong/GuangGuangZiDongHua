import chokidar, { FSWatcher, ChokidarOptions } from 'chokidar';
import { EventEmitter } from 'events';

interface FileWatcherEvents {
  add: string;
  change: string;
  unlink: string;
  addDir: string;
  unlinkDir: string;
  ready: void;
  error: Error;
}

declare interface FileWatcher {
  on<K extends keyof FileWatcherEvents>(
    event: K,
    listener: (arg: FileWatcherEvents[K]) => void
  ): this;
  emit<K extends keyof FileWatcherEvents>(
    event: K,
    arg: FileWatcherEvents[K]
  ): boolean;
}

class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null;
  private path: string;
  private options: ChokidarOptions;

  constructor(path: string, options: ChokidarOptions = {}) {
    super();
    this.path = path;
    this.options = {
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        /node_modules/,
      ],
      persistent: true,
      depth: 3,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
      ...options,
    };
    this.watcher = null;
  }

  /**
   * 启动文件监控
   */
  start(): void {
    this.watcher = chokidar.watch(this.path, this.options);

    this.watcher
      .on('add', (path: string) => this.emit('add', path))
      .on('change', (path: string) => this.emit('change', path))
      .on('unlink', (path: string) => this.emit('unlink', path))
      .on('addDir', (path: string) => this.emit('addDir', path))
      .on('unlinkDir', (path: string) => this.emit('unlinkDir', path))
      .on('ready', () => this.emit('ready', void 0))
      .on('error', (error: any) => this.emit('error', error));
  }

  /**
   * 停止文件监控
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * 获取当前监控的路径
   */
  getPath(): string {
    return this.path;
  }
}

export default FileWatcher;

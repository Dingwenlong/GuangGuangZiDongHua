import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';

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
    log: { message: string; type: 'info' | 'success' | 'warning' | 'error' | 'debug' };
}

declare interface DirectoryMonitor {
    on<K extends keyof DirectoryMonitorEvents>(event: K, listener: (arg: DirectoryMonitorEvents[K]) => void): this;
    emit<K extends keyof DirectoryMonitorEvents>(event: K, arg: DirectoryMonitorEvents[K]): boolean;
}

class DirectoryMonitor extends EventEmitter {
    private monitorDirectory: string;
    private watcher: FSWatcher | null;
    private updateInterval: NodeJS.Timeout | null;
    private maxDepth: number;
    private videoExtensions: Set<string>;
    private debounceTimer: NodeJS.Timeout | null;
    private debounceDelay: number;

    constructor(monitorDirectory: string, options: {
        maxDepth?: number;
        updateInterval?: number;
        debounceDelay?: number;
    } = {}) {
        super();
        this.monitorDirectory = monitorDirectory;
        this.watcher = null;
        this.updateInterval = null;
        this.debounceTimer = null;

        // 配置选项
        this.maxDepth = options.maxDepth ?? 3;
        this.debounceDelay = options.debounceDelay ?? 500;

        // 支持的视频格式
        this.videoExtensions = new Set([
            '.mp4', '.avi', '.mov', '.mkv', '.wmv',
            '.flv', '.webm', '.m4v', '.3gp', '.ogg'
        ]);
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
            type: 'success'
        });
    }

    /**
     * 停止目录监控
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.emit('log', { message: '目录监控已停止', type: 'info' });
        }

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.emit('log', { message: '目录监控已完全停止', type: 'info' });
    }

    /**
     * 启动文件监控
     */
    private startFileWatching(): void {
        this.watcher = chokidar.watch(this.monitorDirectory, {
            ignored: [
                /(^|[\/\\])\../,  // 忽略隐藏文件
                /node_modules/
            ],
            persistent: true,
            depth: this.maxDepth,
            ignoreInitial: false,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
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
            .on('error', (error: any) => {
                this.emit('log', {
                    message: `目录监控错误: ${error.message}`,
                    type: 'error'
                });
            });
    }

    /**
     * 防抖更新目录结构
     */
    private scheduleUpdate(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.emitDirectoryStructure();
        }, this.debounceDelay);
    }

    /**
     * 发送目录结构事件
     */
    private emitDirectoryStructure(): void {
        const structure = this.getDirectoryStructure(this.monitorDirectory);
        this.emit('directoryStructure', {
            root: this.monitorDirectory,
            structure
        });
    }

    /**
     * 获取目录结构
     */
    private getDirectoryStructure(dirPath: string, currentDepth: number = 0): DirectoryItem[] {
        const items: DirectoryItem[] = [];

        try {
            const files = fs.readdirSync(dirPath);

            for (const file of files) {
                const fullPath = path.join(dirPath, file);
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory()) {
                    // 递归获取子目录内容，限制深度
                    const children = currentDepth < this.maxDepth
                        ? this.getDirectoryStructure(fullPath, currentDepth + 1)
                        : [];

                    items.push({
                        name: file,
                        path: fullPath,
                        type: 'directory',
                        children
                    });
                } else {
                    // 判断是否是视频文件
                    const isVideo = this.isVideoFile(fullPath);
                    const isProcessed = isVideo && this.isProcessedVideoFile(fullPath);

                    items.push({
                        name: file,
                        path: fullPath,
                        type: 'file',
                        size: stats.size,
                        isVideo,
                        isProcessed
                    });
                }
            }
        } catch (error) {
            this.emit('log', {
                message: `读取目录失败: ${dirPath} - ${(error as Error).message}`,
                type: 'error'
            });
        }

        return items;
    }

    /**
     * 判断是否为视频文件
     */
    private isVideoFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.videoExtensions.has(ext);
    }

    /**
     * 判断是否为已处理的视频文件
     */
    private isProcessedVideoFile(filePath: string): boolean {
        const fileName = path.basename(filePath);
        const processedPattern = /^.+\-\-\-\d+\.mp4$/;
        return processedPattern.test(fileName);
    }

    /**
     * 手动获取当前目录结构
     */
    getCurrentStructure(): DirectoryItem[] {
        return this.getDirectoryStructure(this.monitorDirectory);
    }
}

export default DirectoryMonitor;

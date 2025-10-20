import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

// 类型定义
interface VideoProcessorOptions {
    fileKeyMethod?: 'path' | 'path-size-mtime';
    [key: string]: any;
}

interface ProcessingQueueItem {
    key: string;
    eventType: string;
    addedTime: number;
    processing: boolean;
    retryCount: number;
}

interface StatusObject {
    monitoring: boolean;
    productCount: number;
    readyCount: number;
    processingStatus: string;
    queueSize: number;
}

interface LogEvent {
    message: string;
    type: 'info' | 'error' | 'success' | 'warning' | 'debug';
}

class VideoProcessor extends EventEmitter {
    private monitorDirectory: string;
    private watcher: chokidar.FSWatcher | null;
    private mergeInterval: NodeJS.Timeout | null;
    private options: VideoProcessorOptions;
    private currentlyProcessing: Set<string>;
    private recentlyProcessed: Map<string, number>;
    private recentlyProcessedCleanup: NodeJS.Timeout | null;
    private processingQueue: Map<string, ProcessingQueueItem>;
    private status: StatusObject;
    private videoExtensions: Set<string>;
    private queueProcessInterval!: NodeJS.Timeout | null;

    constructor(monitorDirectory: string, options: VideoProcessorOptions = {}) {
        super();
        this.monitorDirectory = monitorDirectory;
        this.watcher = null;
        this.mergeInterval = null;

        // 配置选项
        this.options = {
            fileKeyMethod: 'path', // 'path' 或 'path-size-mtime'
            ...options
        };

        // 处理状态跟踪
        this.currentlyProcessing = new Set<string>();     // 正在处理的文件键
        this.recentlyProcessed = new Map<string, number>();       // 最近处理的文件（防重复）
        this.recentlyProcessedCleanup = null;     // 清理定时器
        this.processingQueue = new Map<string, ProcessingQueueItem>();         // 处理队列

        // 系统状态
        this.status = {
            monitoring: false,
            productCount: 0,
            readyCount: 0,
            processingStatus: '空闲',
            queueSize: 0
        };

        // 支持的视频格式
        this.videoExtensions = new Set<string>([
            '.mp4', '.avi', '.mov', '.mkv', '.wmv',
            '.flv', '.webm', '.m4v', '.3gp', '.ogg'
        ]);
    }

    /**
     * 获取文件标识键
     */
    private getFileKey(filePath: string): string {
        // 默认使用文件全路径
        if (this.options.fileKeyMethod === 'path') {
            return filePath;
        }

        // 使用文件路径+大小+修改时间
        if (this.options.fileKeyMethod === 'path-size-mtime') {
            try {
                const stats = fs.statSync(filePath);
                return `${filePath}:${stats.size}:${stats.mtimeMs}`;
            } catch (error) {
                // 如果无法获取文件信息，回退到使用路径
                return filePath;
            }
        }

        // 默认回退到路径
        return filePath;
    }

    /**
     * 启动文件监控
     */
    public start(): void {
        if (!this.monitorDirectory || !fs.existsSync(this.monitorDirectory)) {
            this.emit('log', { message: '监控目录不存在', type: 'error' } as LogEvent);
            return;
        }

        // 创建必要的子目录
        this.createSubdirectories();

        // 启动文件监控
        this.startFileWatching();

        // 定期检查合并条件
        this.mergeInterval = setInterval(() => this.checkMergeCondition(), 10000);

        // 启动处理队列检查
        this.startQueueProcessing();

        this.emit('log', {
            message: `视频处理器已启动，监控目录: ${this.monitorDirectory}，文件标识方法: ${this.options.fileKeyMethod}`,
            type: 'success'
        } as LogEvent);
    }

    /**
     * 停止文件监控
     */
    public stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.emit('log', { message: '文件监控已停止', type: 'info' } as LogEvent);
        }

        if (this.mergeInterval) {
            clearInterval(this.mergeInterval);
        }

        if (this.recentlyProcessedCleanup) {
            clearTimeout(this.recentlyProcessedCleanup);
        }

        if (this.queueProcessInterval) {
            clearInterval(this.queueProcessInterval);
        }

        this.status.monitoring = false;
        this.status.processingStatus = '已停止';
        this.updateStatus();

        this.emit('log', { message: '视频处理器已完全停止', type: 'info' } as LogEvent);
    }

    /**
     * 创建必要的子目录
     */
    private createSubdirectories(): void {
        const subtitleTaskDir = path.join(this.monitorDirectory, '视频去字幕任务');
        const tempDir = path.join(this.monitorDirectory, 'temp');

        [subtitleTaskDir, tempDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                this.emit('log', { message: `创建目录: ${dir}`, type: 'info' } as LogEvent);
            }
        });
    }

    /**
     * 启动文件监控
     */
    private startFileWatching(): void {
        this.watcher = chokidar.watch(this.monitorDirectory, {
            ignored: [
                /(^|[\/\\])\../,                    // 忽略隐藏文件
                /.*---\d+\.mp4$/,                   // 忽略已处理的视频文件
                /视频去字幕任务/,                    // 忽略输出目录
                /temp/,                            // 忽略临时目录
                /node_modules/
            ],
            persistent: true,
            depth: 3,                              // 监控深度增加到3层
            ignoreInitial: false,                  // 不忽略初始文件
            awaitWriteFinish: {
                stabilityThreshold: 3000,          // 文件稳定3秒后才触发
                pollInterval: 500
            },
            interval: 2000,                        // 轮询间隔
            binaryInterval: 3000
        });

        this.watcher
            .on('add', (filePath: string) => this.handleFileEvent(filePath, 'add'))
            .on('change', (filePath: string) => this.handleFileEvent(filePath, 'change'))
            .on('unlink', (filePath: string) => this.handleFileDelete(filePath))
            .on('ready', () => {
                this.status.monitoring = true;
                this.updateStatus();
                this.emit('log', { message: '文件监控系统就绪', type: 'success' } as LogEvent);

                // 扫描现有文件
                setTimeout(() => this.scanExistingFiles(), 5000);
            })
            .on('error', (error: any) => {
                this.emit('log', { message: `文件监控错误: ${error.message}`, type: 'error' } as LogEvent);
            });
    }

    /**
     * 处理文件事件
     */
    private async handleFileEvent(filePath: string, eventType: string): Promise<void> {
        // 基础检查
        if (!this.isVideoFile(filePath) || !this.isInProductDirectory(filePath)) {
            return;
        }

        // 检查是否是处理后的视频文件
        if (this.isProcessedVideoFile(filePath)) {
            return;
        }

        try {
            // 等待文件稳定
            await this.waitForFileStable(filePath);

            // 获取文件标识键
            const fileKey = this.getFileKey(filePath);

            // 检查是否正在处理或已处理
            if (this.isFileBeingProcessed(fileKey)) {
                return;
            }

            // 添加到处理队列
            this.addToProcessingQueue(filePath, fileKey, eventType);

        } catch (error) {
            this.emit('log', {
                message: `处理文件事件失败: ${path.basename(filePath)} - ${(error as Error).message}`,
                type: 'error'
            } as LogEvent);
        }
    }

    /**
     * 处理文件删除
     */
    private handleFileDelete(filePath: string): void {
        try {
            // 获取文件标识键
            const fileKey = this.getFileKey(filePath);

            // 从处理状态中移除
            this.currentlyProcessing.delete(fileKey);
            this.recentlyProcessed.delete(fileKey);

            // 从处理队列中移除
            this.processingQueue.delete(filePath);

            this.updateQueueStatus();

            this.emit('log', {
                message: `文件已删除，清理处理状态: ${path.basename(filePath)}`,
                type: 'info'
            } as LogEvent);

        } catch (error) {
            this.emit('log', {
                message: `处理文件删除时出错: ${path.basename(filePath)} - ${(error as Error).message}`,
                type: 'warning'
            } as LogEvent);
        }
    }

    /**
     * 启动处理队列
     */
    private startQueueProcessing(): void {
        // 每2秒处理一个队列项目
        this.queueProcessInterval = setInterval(async () => {
            if (this.processingQueue.size > 0) {
                // 获取队列中的第一个项目
                const firstEntry = this.processingQueue.entries().next().value;

                // 检查条目是否存在
                if (firstEntry) {
                    const [filePath, queueItem] = firstEntry;

                    // 确保队列项存在且未在处理中
                    if (queueItem && !queueItem.processing) {
                        await this.processQueuedVideo(filePath, queueItem);
                    }
                }
            }
        }, 2000);
    }

    /**
     * 添加到处理队列
     */
    private addToProcessingQueue(filePath: string, fileKey: string, eventType: string): void {
        this.processingQueue.set(filePath, {
            key: fileKey,
            eventType: eventType,
            addedTime: Date.now(),
            processing: false,
            retryCount: 0
        });

        this.updateQueueStatus();

        this.emit('log', {
            message: `已加入处理队列: ${path.basename(filePath)} (队列长度: ${this.processingQueue.size})`,
            type: 'info'
        } as LogEvent);
    }

    /**
     * 处理队列中的视频
     */
    private async processQueuedVideo(filePath: string, queueItem: ProcessingQueueItem): Promise<void> {
        // 标记为处理中
        queueItem.processing = true;
        this.currentlyProcessing.add(queueItem.key);

        this.emit('log', {
            message: `开始处理视频: ${path.basename(filePath)}`,
            type: 'info'
        } as LogEvent);

        try {
            await this.processVideo(filePath);

            // 处理成功，从队列移除
            this.processingQueue.delete(filePath);

            // 记录到最近处理列表（30分钟防重复）
            this.recentlyProcessed.set(queueItem.key, Date.now());
            this.scheduleCleanup();

        } catch (error) {
            queueItem.retryCount++;
            queueItem.processing = false;
            this.currentlyProcessing.delete(queueItem.key);

            if (queueItem.retryCount >= 3) {
                this.emit('log', {
                    message: `视频处理失败，已达到重试次数: ${path.basename(filePath)}`,
                    type: 'error'
                } as LogEvent);
                this.processingQueue.delete(filePath);
            } else {
                this.emit('log', {
                    message: `视频处理失败，等待重试: ${path.basename(filePath)} (${queueItem.retryCount}/3)`,
                    type: 'warning'
                } as LogEvent);
            }
        } finally {
            this.updateQueueStatus();
        }
    }

    /**
     * 处理视频文件
     */
    private async processVideo(inputPath: string): Promise<void> {
        const productDir = path.dirname(inputPath);
        let duration: number;

        try {
            duration = await this.getVideoDuration(inputPath);
            this.emit('log', { message: `视频时长: ${duration.toFixed(2)}秒`, type: 'info' } as LogEvent);
        } catch (error) {
            throw new Error(`无法获取视频时长: ${(error as Error).message}`);
        }

        // 根据时长处理视频
        if (Math.abs(duration - 20) < 0.1) {
            this.emit('log', { message: '视频时长正好20秒，无需处理', type: 'info' } as LogEvent);
            return;
        }

        if (duration < 16) {
            this.emit('log', { message: '视频时长小于16秒，无法处理', type: 'warning' } as LogEvent);
            return;
        }

        // 获取输出文件名
        const outputFileName = await this.getOutputFileName(productDir);
        const outputPath = path.join(productDir, outputFileName);

        this.status.processingStatus = `处理中: ${path.basename(inputPath)}`;
        this.updateStatus();

        try {
            if (duration >= 16 && duration <= 24) {
                await this.adjustSpeed(inputPath, outputPath, duration);
            } else if (duration > 24) {
                await this.trimVideo(inputPath, outputPath);
            }

            // 验证输出文件
            await this.verifyOutputVideo(outputPath);

            // 删除原视频
            fs.unlinkSync(inputPath);

            this.emit('log', {
                message: `视频处理完成: ${outputFileName} (${duration.toFixed(2)}秒 → 20.00秒)`,
                type: 'success'
            } as LogEvent);

        } catch (error) {
            // 清理可能生成的不完整输出文件
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            throw new Error(`视频处理失败: ${(error as Error).message}`);
        } finally {
            this.status.processingStatus = '空闲';
            this.updateStatus();
        }
    }

    /**
     * 调整视频速度
     */
    private async adjustSpeed(inputPath: string, outputPath: string, duration: number): Promise<void> {
        const speed = duration / 20;

        this.emit('log', {
            message: `变速处理: 速度比例 ${speed.toFixed(3)}`,
            type: 'info'
        });

        try {
            const args = [
                '-i', inputPath,
                '-vf', `setpts=${1/speed}*PTS`,
                '-af', `atempo=${speed > 2 ? 2 : speed}`,
                ...(speed > 2 ? ['-af', `atempo=${speed/2}`] : []),
                '-t', '20',
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                outputPath
            ];

            await this.executeFFmpeg(args, '变速处理');
        } catch (error) {
            throw new Error(`变速处理失败: ${(error as Error).message}`);
        }
    }

    /**
     * 截取视频前20秒
     */
    private async trimVideo(inputPath: string, outputPath: string): Promise<void> {
        this.emit('log', { message: '截取视频前20秒', type: 'info' });

        try {
            const args = [
                '-i', inputPath,
                '-t', '20',
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                outputPath
            ];

            await this.executeFFmpeg(args, '截取处理');
        } catch (error) {
            throw new Error(`截取处理失败: ${(error as Error).message}`);
        }
    }

    /**
     * 执行 FFmpeg 命令
     */
    private async executeFFmpeg(args: string[], operationName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = execFile(ffmpegPath, args);

            child.stdout?.on('data', (data) => {
                // FFmpeg 输出通常在 stderr
            });

            child.stderr?.on('data', (data) => {
                // 解析进度信息
                const progress = this.parseFFmpegProgress(data.toString());
                if (progress !== null) {
                    this.status.processingStatus = `${operationName}: ${progress.toFixed(1)}%`;
                    this.updateStatus();
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * 解析 FFmpeg 进度信息
     */
    private parseFFmpegProgress(stderr: string): number | null {
        // FFmpeg 进度格式示例: frame=  123 fps= 25 q=28.0 size=    1024kB time=00:00:04.92 bitrate=1680.8kbits/s speed=1.03x
        const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseFloat(timeMatch[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;

            // 假设目标时长为20秒，计算进度百分比
            const progress = Math.min(100, (totalSeconds / 20) * 100);
            return progress;
        }
        return null;
    }

    /**
     * 获取视频时长
     */
    private async getVideoDuration(filePath: string): Promise<number> {
        try {
            const args = [
                '-i', filePath,
                '-hide_banner'
            ];

            const { stderr } = await execFileAsync(ffmpegPath, args);

            // 从 FFmpeg 输出中解析时长
            const durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
            if (durationMatch) {
                const hours = parseInt(durationMatch[1], 10);
                const minutes = parseInt(durationMatch[2], 10);
                const seconds = parseFloat(durationMatch[3]);
                return hours * 3600 + minutes * 60 + seconds;
            }

            throw new Error('无法从 FFmpeg 输出中解析视频时长');
        } catch (error) {
            throw new Error(`获取视频时长失败: ${(error as Error).message}`);
        }
    }

    /**
     * 验证输出视频
     */
    private async verifyOutputVideo(filePath: string): Promise<void> {
        try {
            const duration = await this.getVideoDuration(filePath);
            if (Math.abs(duration - 20) > 1) {
                throw new Error(`输出视频时长异常: ${duration}秒`);
            }
        } catch (error) {
            throw new Error(`验证输出视频失败: ${(error as Error).message}`);
        }
    }

    /**
     * 获取输出文件名
     */
    private async getOutputFileName(productDir: string): Promise<string> {
        const files = fs.readdirSync(productDir);
        const processedVideos = files.filter(file =>
            file.endsWith('.mp4') && file.includes('---')
        );

        let maxNumber = 0;
        processedVideos.forEach(file => {
            const match = file.match(/---(\d+)\.mp4$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNumber) maxNumber = num;
            }
        });

        const productName = path.basename(productDir).replace('S1---', '');
        return `${productName}---${maxNumber + 1}.mp4`;
    }

    /**
     * 检查合并条件
     */
    private async checkMergeCondition(): Promise<void> {
        if (this.processingQueue.size > 0) {
            return; // 队列中有任务时暂不合并
        }

        const productDirs = this.getProductDirectories();
        const readyDirs = productDirs.filter(dir => {
            const videos = this.getProcessedVideos(dir);
            return videos.length >= 4;
        });

        this.status.productCount = productDirs.length;
        this.status.readyCount = readyDirs.length;
        this.updateStatus();

        if (productDirs.length >= 5 && readyDirs.length >= 5) {
            this.emit('log', {
                message: `满足合并条件: 商品目录${productDirs.length}个, 就绪目录${readyDirs.length}个`,
                type: 'info'
            } as LogEvent);
            await this.mergeVideos();
        }
    }

    /**
     * 合并视频
     */
    private async mergeVideos(): Promise<void> {
        this.status.processingStatus = '开始合并视频';
        this.updateStatus();

        try {
            const productDirs = this.getProductDirectories()
                .sort()
                .slice(0, 5);

            const videoFiles: string[] = [];
            productDirs.forEach(dir => {
                const videos = this.getProcessedVideos(dir);
                videoFiles.push(...videos.slice(0, 4));
            });

            if (videoFiles.length !== 20) {
                throw new Error(`视频数量不足20个，当前: ${videoFiles.length}`);
            }

            const outputDir = path.join(this.monitorDirectory, '视频去字幕任务');
            const outputFileName = `S1---${Date.now()}.mp4`;
            const outputPath = path.join(outputDir, outputFileName);

            this.emit('log', {
                message: `开始合并 ${videoFiles.length} 个视频`,
                type: 'info'
            } as LogEvent);

            await this.concatVideos(videoFiles, outputPath);

            // 清空商品目录并重命名
            await this.cleanAndRenameProductDirs(productDirs);

            this.emit('log', {
                message: `视频合并成功: ${outputFileName} (总时长: 400秒)`,
                type: 'success'
            } as LogEvent);

        } catch (error) {
            this.emit('log', {
                message: `视频合并失败: ${(error as Error).message}`,
                type: 'error'
            } as LogEvent);
        } finally {
            this.status.processingStatus = '空闲';
            this.updateStatus();
        }
    }

    /**
     * 连接视频文件
     */
    private async concatVideos(videoFiles: string[], outputPath: string): Promise<void> {
        const tempDir = path.join(this.monitorDirectory, 'temp');
        const listPath = path.join(tempDir, `concat_list_${Date.now()}.txt`);

        try {
            // 创建 concat 列表文件
            const listContent = videoFiles.map(file => `file '${path.resolve(file)}'`).join('\n');
            fs.writeFileSync(listPath, listContent);

            const args = [
                '-f', 'concat',
                '-safe', '0',
                '-i', listPath,
                '-c', 'copy',
                outputPath
            ];

            await this.executeFFmpeg(args, '合并进度');
        } catch (error) {
            throw new Error(`合并视频失败: ${(error as Error).message}`);
        } finally {
            // 清理临时文件
            try {
                if (fs.existsSync(listPath)) {
                    fs.unlinkSync(listPath);
                }
            } catch (e) {
                // 忽略清理错误
            }
        }
    }

    /**
     * 清空并重命名商品目录
     */
    private async cleanAndRenameProductDirs(productDirs: string[]): Promise<void> {
        for (const dir of productDirs) {
            try {
                // 清空目录中的所有文件
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    if (fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                    }
                }

                // 重命名目录
                const newDirName = dir.replace('S1---', 'S2---');
                fs.renameSync(dir, newDirName);

                this.emit('log', {
                    message: `已清空并重命名目录: ${path.basename(newDirName)}`,
                    type: 'info'
                } as LogEvent);

            } catch (error) {
                this.emit('log', {
                    message: `处理目录失败: ${path.basename(dir)} - ${(error as Error).message}`,
                    type: 'error'
                } as LogEvent);
            }
        }
    }

    /**
     * 工具方法
     */

    // 判断是否为视频文件
    private isVideoFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.videoExtensions.has(ext);
    }

    // 判断是否在商品目录中
    private isInProductDirectory(filePath: string): boolean {
        const dirName = path.dirname(filePath);
        const baseDir = path.basename(dirName);
        return baseDir.startsWith('S1---') && !path.basename(filePath).startsWith('S1---');
    }

    // 判断是否为已处理的视频文件
    private isProcessedVideoFile(filePath: string): boolean {
        const fileName = path.basename(filePath);
        const processedPattern = /^.+\-\-\-\d+\.mp4$/;
        return processedPattern.test(fileName);
    }

    // 检查文件是否正在处理
    private isFileBeingProcessed(fileKey: string): boolean {
        return this.currentlyProcessing.has(fileKey) || this.recentlyProcessed.has(fileKey);
    }

    // 等待文件稳定
    private waitForFileStable(filePath: string, timeout = 30000): Promise<void> {
        return new Promise((resolve, reject) => {
            let size = 0;
            let stableCount = 0;
            const startTime = Date.now();

            const check = (): void => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error('文件稳定等待超时'));
                    return;
                }

                try {
                    const stats = fs.statSync(filePath);
                    if (stats.size === size) {
                        stableCount++;
                        if (stableCount >= 3) {
                            resolve();
                            return;
                        }
                    } else {
                        size = stats.size;
                        stableCount = 0;
                    }
                    setTimeout(check, 1000);
                } catch (error) {
                    reject(new Error(`无法访问文件: ${(error as Error).message}`));
                }
            };

            check();
        });
    }

    // 获取商品目录列表
    private getProductDirectories(): string[] {
        try {
            const items = fs.readdirSync(this.monitorDirectory);
            return items
                .filter(item => {
                    const fullPath = path.join(this.monitorDirectory, item);
                    return fs.statSync(fullPath).isDirectory() && item.startsWith('S1---');
                })
                .map(item => path.join(this.monitorDirectory, item));
        } catch (error) {
            return [];
        }
    }

    // 获取已处理的视频列表
    private getProcessedVideos(productDir: string): string[] {
        try {
            const files = fs.readdirSync(productDir);
            return files
                .filter(file => file.endsWith('.mp4') && file.includes('---'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/---(\d+)\.mp4$/)?.[1] || '0', 10);
                    const numB = parseInt(b.match(/---(\d+)\.mp4$/)?.[1] || '0', 10);
                    return numB - numA;
                })
                .slice(0, 4)
                .map(file => path.join(productDir, file));
        } catch (error) {
            return [];
        }
    }

    // 扫描现有文件
    private scanExistingFiles(): void {
        this.emit('log', { message: '开始扫描现有文件', type: 'info' } as LogEvent);

        const productDirs = this.getProductDirectories();
        let foundCount = 0;

        productDirs.forEach(dir => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                if (this.isVideoFile(filePath) && !this.isProcessedVideoFile(filePath)) {
                    this.handleFileEvent(filePath, 'scan');
                    foundCount++;
                }
            });
        });

        this.emit('log', {
            message: `扫描完成，发现 ${foundCount} 个待处理文件`,
            type: 'info'
        } as LogEvent);
    }

    // 定期清理最近处理的记录
    private scheduleCleanup(): void {
        if (this.recentlyProcessedCleanup) {
            clearTimeout(this.recentlyProcessedCleanup);
        }

        this.recentlyProcessedCleanup = setTimeout(() => {
            const now = Date.now();
            const thirtyMinutesAgo = now - 30 * 60 * 1000;

            for (const [key, timestamp] of this.recentlyProcessed.entries()) {
                if (timestamp < thirtyMinutesAgo) {
                    this.recentlyProcessed.delete(key);
                }
            }
        }, 60000);
    }

    // 更新队列状态
    private updateQueueStatus(): void {
        this.status.queueSize = this.processingQueue.size;
        this.updateStatus();
    }

    // 更新系统状态
    private updateStatus(): void {
        this.emit('status', this.status);
    }

    // 获取处理统计
    public getProcessingStats(): {
        currentlyProcessing: number;
        recentlyProcessed: number;
        queueSize: number;
        productDirs: number;
    } {
        return {
            currentlyProcessing: this.currentlyProcessing.size,
            recentlyProcessed: this.recentlyProcessed.size,
            queueSize: this.processingQueue.size,
            productDirs: this.getProductDirectories().length
        };
    }
}

export default VideoProcessor;

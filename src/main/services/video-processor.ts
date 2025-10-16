import { EventEmitter } from 'events';
import fs, { Stats } from 'fs';
import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import ffmpeg, { FfprobeData } from 'fluent-ffmpeg';
import crypto from 'crypto';

interface VideoProcessorEvents {
    log: { message: string; type: 'info' | 'success' | 'warning' | 'error' | 'debug' };
    status: {
        monitoring: boolean;
        productCount: number;
        readyCount: number;
        processingStatus: string;
        queueSize: number;
    };
}

declare interface VideoProcessor {
    on<K extends keyof VideoProcessorEvents>(event: K, listener: (arg: VideoProcessorEvents[K]) => void): this;
    emit<K extends keyof VideoProcessorEvents>(event: K, arg: VideoProcessorEvents[K]): boolean;
}

interface QueueItem {
    hash: string;
    eventType: string;
    addedTime: number;
    processing: boolean;
    retryCount: number;
}

interface Status {
    monitoring: boolean;
    productCount: number;
    readyCount: number;
    processingStatus: string;
    queueSize: number;
}

interface FfmpegProgress {
    frames?: number;
    currentFps?: number;
    currentKbps?: number;
    targetSize?: number;
    timemark?: string;
    percent?: number;
}

class VideoProcessor extends EventEmitter {
    private monitorDirectory: string;
    private watcher: FSWatcher | null;
    private mergeInterval: NodeJS.Timeout | null;
    private queueProcessInterval: NodeJS.Timeout | null;
    private recentlyProcessedCleanup: NodeJS.Timeout | null;

    private currentlyProcessing: Set<string>;
    private recentlyProcessed: Map<string, number>;
    private processingQueue: Map<string, QueueItem>;

    private status: Status;
    private videoExtensions: Set<string>;

    constructor(monitorDirectory: string) {
        super();
        this.monitorDirectory = monitorDirectory;
        this.watcher = null;
        this.mergeInterval = null;
        this.queueProcessInterval = null;
        this.recentlyProcessedCleanup = null;

        // 处理状态跟踪
        this.currentlyProcessing = new Set();
        this.recentlyProcessed = new Map();
        this.processingQueue = new Map();

        // 系统状态
        this.status = {
            monitoring: false,
            productCount: 0,
            readyCount: 0,
            processingStatus: '空闲',
            queueSize: 0
        };

        // 支持的视频格式
        this.videoExtensions = new Set([
            '.mp4', '.avi', '.mov', '.mkv', '.wmv',
            '.flv', '.webm', '.m4v', '.3gp', '.ogg'
        ]);
    }

    /**
     * 启动文件监控
     */
    start(): void {
        if (!this.monitorDirectory || !fs.existsSync(this.monitorDirectory)) {
            this.emit('log', { message: '监控目录不存在', type: 'error' });
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

        this.emit('log', { message: `视频处理器已启动，监控目录: ${this.monitorDirectory}`, type: 'success' });
    }

    /**
     * 停止文件监控
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.emit('log', { message: '文件监控已停止', type: 'info' });
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

        this.emit('log', { message: '视频处理器已完全停止', type: 'info' });
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
                this.emit('log', { message: `创建目录: ${dir}`, type: 'info' });
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
                this.emit('log', { message: '文件监控系统就绪', type: 'success' });

                // 扫描现有文件
                setTimeout(() => this.scanExistingFiles(), 5000);
            })
            .on('error', (error: any) => {
                this.emit('log', { message: `文件监控错误: ${error.message}`, type: 'error' });
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

            // 获取文件哈希
            const fileHash = await this.getFileHash(filePath);

            // 检查是否正在处理或已处理
            if (this.isFileBeingProcessed(fileHash)) {
                return;
            }

            // 添加到处理队列
            this.addToProcessingQueue(filePath, fileHash, eventType);

        } catch (error) {
            this.emit('log', {
                message: `处理文件事件失败: ${path.basename(filePath)} - ${(error as Error).message}`,
                type: 'error'
            });
        }
    }

    /**
     * 处理文件删除
     */
    private handleFileDelete(filePath: string): void {
        const fileHash = this.getFileKey(filePath);
        this.currentlyProcessing.delete(fileHash);
        this.processingQueue.delete(filePath);

        this.updateQueueStatus();
    }

    /**
     * 启动处理队列
     */
    private startQueueProcessing(): void {
        // 每2秒处理一个队列项目
        this.queueProcessInterval = setInterval(async () => {
            if (this.processingQueue.size > 0) {
                const firstEntry = this.processingQueue.entries().next().value;

                if (firstEntry) {
                    const [filePath, queueItem] = firstEntry;

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
    private addToProcessingQueue(filePath: string, fileHash: string, eventType: string): void {
        this.processingQueue.set(filePath, {
            hash: fileHash,
            eventType: eventType,
            addedTime: Date.now(),
            processing: false,
            retryCount: 0
        });

        this.updateQueueStatus();

        this.emit('log', {
            message: `已加入处理队列: ${path.basename(filePath)} (队列长度: ${this.processingQueue.size})`,
            type: 'info'
        });
    }

    /**
     * 处理队列中的视频
     */
    private async processQueuedVideo(filePath: string, queueItem: QueueItem): Promise<void> {
        // 标记为处理中
        queueItem.processing = true;
        this.currentlyProcessing.add(queueItem.hash);

        this.emit('log', {
            message: `开始处理视频: ${path.basename(filePath)}`,
            type: 'info'
        });

        try {
            await this.processVideo(filePath);

            // 处理成功，从队列移除
            this.processingQueue.delete(filePath);

            // 记录到最近处理列表（30分钟防重复）
            this.recentlyProcessed.set(queueItem.hash, Date.now());
            this.scheduleCleanup();

        } catch (error) {
            queueItem.retryCount++;
            queueItem.processing = false;
            this.currentlyProcessing.delete(queueItem.hash);

            if (queueItem.retryCount >= 3) {
                this.emit('log', {
                    message: `视频处理失败，已达到重试次数: ${path.basename(filePath)}`,
                    type: 'error'
                });
                this.processingQueue.delete(filePath);
            } else {
                this.emit('log', {
                    message: `视频处理失败，等待重试: ${path.basename(filePath)} (${queueItem.retryCount}/3)`,
                    type: 'warning'
                });
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
            this.emit('log', { message: `视频时长: ${duration.toFixed(2)}秒`, type: 'info' });
        } catch (error) {
            throw new Error(`无法获取视频时长: ${(error as Error).message}`);
        }

        // 根据时长处理视频
        if (Math.abs(duration - 20) < 0.1) {
            this.emit('log', { message: '视频时长正好20秒，无需处理', type: 'info' });
            return;
        }

        if (duration < 16) {
            this.emit('log', { message: '视频时长小于16秒，无法处理', type: 'warning' });
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
            });

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
    private adjustSpeed(inputPath: string, outputPath: string, duration: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const speed = duration / 20;

            this.emit('log', {
                message: `变速处理: 速度比例 ${speed.toFixed(3)}`,
                type: 'info'
            });

            const command = ffmpeg(inputPath)
                .videoFilter(`setpts=${1/speed}*PTS`)
                .audioFilter(`atempo=${speed > 2 ? 2 : speed}`); // atempo限制最大2倍

            if (speed > 2) {
                command.audioFilters([`atempo=2`, `atempo=${speed/2}`]); // 如果超过2倍，分两次处理
            }

            command
                .duration(20)
                .outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 128k'
                ])
                .output(outputPath)
                .on('start', (commandLine: string) => {
                    this.emit('log', { message: `FFmpeg 命令: ${commandLine}`, type: 'debug' });
                })
                .on('progress', (progress: FfmpegProgress) => {
                    if (progress.percent) {
                        this.status.processingStatus = `变速处理: ${progress.percent.toFixed(1)}%`;
                        this.updateStatus();
                    }
                })
                .on('end', () => resolve())
                .on('error', (error: Error) => reject(error))
                .run();
        });
    }

    /**
     * 截取视频前20秒
     */
    private trimVideo(inputPath: string, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.emit('log', { message: '截取视频前20秒', type: 'info' });

            ffmpeg(inputPath)
                .duration(20)
                .outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 128k'
                ])
                .output(outputPath)
                .on('start', (commandLine: string) => {
                    this.emit('log', { message: `FFmpeg 命令: ${commandLine}`, type: 'debug' });
                })
                .on('progress', (progress: FfmpegProgress) => {
                    if (progress.percent) {
                        this.status.processingStatus = `截取处理: ${progress.percent.toFixed(1)}%`;
                        this.updateStatus();
                    }
                })
                .on('end', () => resolve())
                .on('error', (error: Error) => reject(error))
                .run();
        });
    }

    /**
     * 获取视频时长
     */
    private getVideoDuration(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err: Error | null, metadata: FfprobeData) => {
                if (err) {
                    reject(err);
                } else {
                    const duration = metadata.format.duration;
                    resolve(duration ?? 0);
                }
            });
        });
    }

    /**
     * 验证输出视频
     */
    private verifyOutputVideo(filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (!fs.existsSync(filePath)) {
                    reject(new Error('输出文件不存在'));
                    return;
                }

                ffmpeg.ffprobe(filePath, (err: Error | null, metadata: FfprobeData) => {
                    if (err) {
                        reject(new Error(`无法验证输出视频: ${err.message}`));
                    } else {
                        const duration = metadata.format.duration ?? 0;
                        if (Math.abs(duration - 20) > 1) {
                            reject(new Error(`输出视频时长异常: ${duration}秒`));
                        } else {
                            resolve();
                        }
                    }
                });
            }, 1000);
        });
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
            });
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
            });

            await this.concatVideos(videoFiles, outputPath);

            // 清空商品目录并重命名
            await this.cleanAndRenameProductDirs(productDirs);

            this.emit('log', {
                message: `视频合并成功: ${outputFileName} (总时长: 400秒)`,
                type: 'success'
            });

        } catch (error) {
            this.emit('log', {
                message: `视频合并失败: ${(error as Error).message}`,
                type: 'error'
            });
        } finally {
            this.status.processingStatus = '空闲';
            this.updateStatus();
        }
    }

    /**
     * 连接视频文件
     */
    private concatVideos(videoFiles: string[], outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const listPath = path.join(this.monitorDirectory, 'temp', `concat_list_${Date.now()}.txt`);
            const listContent = videoFiles.map(file => `file '${path.resolve(file)}'`).join('\n');
            fs.writeFileSync(listPath, listContent);

            this.status.processingStatus = '合并视频中...';
            this.updateStatus();

            ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions(['-c copy'])
                .output(outputPath)
                .on('start', (commandLine: string) => {
                    this.emit('log', { message: `合并命令: ${commandLine}`, type: 'debug' });
                })
                .on('progress', (progress: FfmpegProgress) => {
                    if (progress.percent) {
                        this.status.processingStatus = `合并进度: ${progress.percent.toFixed(1)}%`;
                        this.updateStatus();
                    }
                })
                .on('end', () => {
                    fs.unlinkSync(listPath);
                    resolve();
                })
                .on('error', (error: Error) => {
                    fs.unlinkSync(listPath);
                    reject(error);
                })
                .run();
        });
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
                    const stats = fs.statSync(filePath);
                    if (stats.isFile()) {
                        fs.unlinkSync(filePath);
                    }
                }

                // 重命名目录
                const newDirName = dir.replace('S1---', 'S2---');
                fs.renameSync(dir, newDirName);

                this.emit('log', {
                    message: `已清空并重命名目录: ${path.basename(newDirName)}`,
                    type: 'info'
                });

            } catch (error) {
                this.emit('log', {
                    message: `处理目录失败: ${path.basename(dir)} - ${(error as Error).message}`,
                    type: 'error'
                });
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

    // 获取文件哈希 - 使用类型守卫
    private async getFileHash(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);

            stream.on('data', (chunk: string | Buffer) => {
                if (typeof chunk === 'string') {
                    hash.update(Buffer.from(chunk));
                } else {
                    hash.update(chunk);
                }
            });
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', (error: Error) => reject(error));
        });
    }

    // 获取文件标识键
    private getFileKey(filePath: string): string {
        try {
            const stats = fs.statSync(filePath);
            return `${filePath}:${stats.size}:${stats.mtimeMs}`;
        } catch (error) {
            return filePath;
        }
    }

    // 检查文件是否正在处理
    private isFileBeingProcessed(fileHash: string): boolean {
        return this.currentlyProcessing.has(fileHash) || this.recentlyProcessed.has(fileHash);
    }

    // 等待文件稳定
    private waitForFileStable(filePath: string, timeout = 30000): Promise<void> {
        return new Promise((resolve, reject) => {
            let size = 0;
            let stableCount = 0;
            const startTime = Date.now();

            const check = () => {
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
                    const stats = fs.statSync(fullPath);
                    return stats.isDirectory() && item.startsWith('S1---');
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
                    const matchA = a.match(/---(\d+)\.mp4$/);
                    const matchB = b.match(/---(\d+)\.mp4$/);
                    const numA = matchA ? parseInt(matchA[1], 10) : 0;
                    const numB = matchB ? parseInt(matchB[1], 10) : 0;
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
        this.emit('log', { message: '开始扫描现有文件', type: 'info' });

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
        });
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
    getProcessingStats(): {
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

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import FileWatcher from '../lib/file-watcher';
import { isVideoFile, isProcessedVideoFile } from '../utils/file';
import { FFmpegUtil, FFmpegProgressEvent, VideoSegment } from '../lib/ffmpeg';
import { OrderedVideosChunk } from './workbench-manager';

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
  public monitorDirectory: string;
  private watcher: FileWatcher | null;
  private options: VideoProcessorOptions;
  private currentlyProcessing: Set<string>;
  private recentlyProcessed: Map<string, number>;
  private recentlyProcessedCleanup: NodeJS.Timeout | null;
  private processingQueue: Map<string, ProcessingQueueItem>;
  private status: StatusObject;
  private queueProcessInterval!: NodeJS.Timeout | null;
  private ffmpegUtil: FFmpegUtil;

  // 音频提取任务队列
  private audioExtractQueue: string[];
  private audioExtractInterval: NodeJS.Timeout | null;

  constructor(monitorDirectory: string, options: VideoProcessorOptions = {}) {
    super();
    this.monitorDirectory = monitorDirectory;
    this.watcher = null;

    // 配置选项
    this.options = {
      fileKeyMethod: 'path', // 'path' 或 'path-size-mtime'
      ...options,
    };

    // 处理状态跟踪
    this.currentlyProcessing = new Set<string>(); // 正在处理的文件键
    this.recentlyProcessed = new Map<string, number>(); // 最近处理的文件（防重复）
    this.recentlyProcessedCleanup = null; // 清理定时器
    this.processingQueue = new Map<string, ProcessingQueueItem>(); // 处理队列

    // 音频提取任务队列
    this.audioExtractQueue = [];
    this.audioExtractInterval = null;

    // 系统状态
    this.status = {
      monitoring: false,
      productCount: 0,
      readyCount: 0,
      processingStatus: '空闲',
      queueSize: 0,
    };

    // 初始化FFmpeg工具
    this.ffmpegUtil = FFmpegUtil.getInstance();
    this.setupFFmpegEvents();
  }

  /**
   * 设置FFmpeg事件监听
   */
  private setupFFmpegEvents(): void {
    this.ffmpegUtil.on('progress', (event: FFmpegProgressEvent) => {
      this.status.processingStatus = `${
        event.operation
      }: ${event.progress.toFixed(1)}%`;
      this.updateStatus();
    });

    this.ffmpegUtil.on('log', (event: LogEvent) => {
      this.emit('log', event);
    });
  }

  /**
   * 获取文件标识键
   */
  public getFileKey(filePath: string) {
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
      this.emit('log', {
        message: '监控目录不存在',
        type: 'error',
      } as LogEvent);
      return;
    }

    // 创建必要的子目录
    this.createSubdirectories();

    // 启动文件监控
    this.startFileWatching();

    // 启动音频提取队列处理
    this.startAudioExtractQueueProcessing();

    // 定期检查合并条件
    this.startChecking();

    // 启动处理队列检查
    this.startQueueProcessing();

    this.emit('log', {
      message: `视频处理器已启动，监控目录: ${this.monitorDirectory}，文件标识方法: ${this.options.fileKeyMethod}`,
      type: 'success',
    } as LogEvent);
  }

  /**
   * 停止文件监控
   */
  public stop(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.emit('log', { message: '文件监控已停止', type: 'info' } as LogEvent);
    }

    if (this.recentlyProcessedCleanup) {
      clearTimeout(this.recentlyProcessedCleanup);
    }

    if (this.queueProcessInterval) {
      clearInterval(this.queueProcessInterval);
    }

    if (this.audioExtractInterval) {
      clearInterval(this.audioExtractInterval);
    }

    this.status.monitoring = false;
    this.status.processingStatus = '已停止';
    this.updateStatus();

    this.emit('log', {
      message: '视频处理器已完全停止',
      type: 'info',
    } as LogEvent);
  }

  /**
   * 创建必要的子目录
   */
  private createSubdirectories(): void {
    const subtitleTaskDir = path.join(this.monitorDirectory, '视频去字幕任务');
    const tempDir = path.join(this.monitorDirectory, 'temp');
    const audioOutputDir = path.join(this.monitorDirectory, '音频输出');

    [subtitleTaskDir, tempDir, audioOutputDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.emit('log', {
          message: `创建目录: ${dir}`,
          type: 'info',
        } as LogEvent);
      }
    });
  }

  /**
   * 启动文件监控
   */
  private startFileWatching(): void {
    this.watcher = new FileWatcher(this.monitorDirectory, {
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        /.*---\d+\.mp4$/, // 忽略已处理的视频文件
        /视频去字幕任务/, // 忽略输出目录
        /temp/, // 忽略临时目录
        /node_modules/,
      ],
      depth: 3, // 监控深度增加到3层
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
      .on('unlink', (filePath: string) => this.handleFileDelete(filePath))
      .on('ready', () => {
        this.status.monitoring = true;
        this.updateStatus();
        this.emit('log', {
          message: '文件监控系统就绪',
          type: 'success',
        } as LogEvent);

        // 扫描现有文件
        setTimeout(() => this.scanExistingFiles(), 5000);
      })
      .on('error', (error: Error) => {
        this.emit('log', {
          message: `文件监控错误: ${error.message}`,
          type: 'error',
        } as LogEvent);
      });

    this.watcher.start();
  }

  /**
   * 处理文件事件
   */
  private async handleFileEvent(
    filePath: string,
    eventType: string
  ): Promise<void> {
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
        message: `处理文件事件失败: ${path.basename(filePath)} - ${
          (error as Error).message
        }`,
        type: 'error',
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
        type: 'info',
      } as LogEvent);
    } catch (error) {
      this.emit('log', {
        message: `处理文件删除时出错: ${path.basename(filePath)} - ${
          (error as Error).message
        }`,
        type: 'warning',
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
  private addToProcessingQueue(
    filePath: string,
    fileKey: string,
    eventType: string
  ): void {
    this.processingQueue.set(filePath, {
      key: fileKey,
      eventType: eventType,
      addedTime: Date.now(),
      processing: false,
      retryCount: 0,
    });

    this.updateQueueStatus();

    this.emit('log', {
      message: `已加入处理队列: ${path.basename(filePath)} (队列长度: ${
        this.processingQueue.size
      })`,
      type: 'info',
    } as LogEvent);
  }

  /**
   * 处理队列中的视频
   */
  private async processQueuedVideo(
    filePath: string,
    queueItem: ProcessingQueueItem
  ): Promise<void> {
    // 标记为处理中
    queueItem.processing = true;
    this.currentlyProcessing.add(queueItem.key);

    this.emit('log', {
      message: `开始处理视频: ${path.basename(filePath)}`,
      type: 'info',
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
          type: 'error',
        } as LogEvent);
        this.processingQueue.delete(filePath);
      } else {
        this.emit('log', {
          message: `视频处理失败，等待重试: ${path.basename(filePath)} (${
            queueItem.retryCount
          }/3)`,
          type: 'warning',
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
      duration = await this.ffmpegUtil.getVideoDuration(inputPath);
      this.emit('log', {
        message: `视频时长: ${duration.toFixed(2)}秒`,
        type: 'info',
      } as LogEvent);
    } catch (error) {
      throw new Error(`无法获取视频时长: ${(error as Error).message}`);
    }

    // 根据时长处理视频
    if (Math.abs(duration - 20) < 0.1) {
      this.emit('log', {
        message: '视频时长正好20秒，无需处理',
        type: 'info',
      } as LogEvent);
      return;
    }

    if (duration < 16) {
      this.emit('log', {
        message: '视频时长小于16秒，无法处理',
        type: 'warning',
      } as LogEvent);
      return;
    }

    // 获取输出文件名 - 保留S1---前缀
    const outputFileName = await this.getOutputFileName(productDir);
    const outputPath = path.join(productDir, outputFileName);

    this.status.processingStatus = `处理中: ${path.basename(inputPath)}`;
    this.updateStatus();

    try {
      if (duration >= 16 && duration <= 24) {
        const speed = duration / 20;
        await this.ffmpegUtil.adjustSpeed(inputPath, outputPath, speed);
      } else if (duration > 24) {
        await this.ffmpegUtil.trimVideo(inputPath, outputPath);
      }

      // 验证输出文件
      await this.ffmpegUtil.verifyOutputVideo(outputPath);

      // 删除原视频
      fs.unlinkSync(inputPath);

      this.emit('log', {
        message: `视频处理完成: ${outputFileName} (${duration.toFixed(
          2
        )}秒 → 20.00秒)`,
        type: 'success',
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

  private async startChecking(): Promise<void> {
    // 执行检查
    await this.checkMergeCondition();

    // 等待5秒后再次执行
    setTimeout(() => {
      this.startChecking();
    }, 5000);
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
        type: 'info',
      } as LogEvent);
      await this.mergeVideos();
    }
  }

  /**
   * 合并视频
   */
  private async mergeVideos(): Promise<void> {
    const videosChunk: OrderedVideosChunk = [];
    this.status.processingStatus = '开始合并视频';
    this.updateStatus();

    try {
      const productDirs = this.getProductDirectories().sort().slice(0, 5);

      const videoFiles: string[] = [];
      productDirs.forEach(dir => {
        const videos = this.getProcessedVideos(dir);
        const videosPart = videos.slice(0, 4);
        videoFiles.push(...videosPart);
        // 提前命名为后续铺垫
        videosChunk.push({
          folderName: dir.replace('S1---', 'S2---'),
          videos: videosPart.map(video => {
            return {
              fragmentDuration: 20,
              fileName: video.replace(dir, '').replace('S1---', 'S2---'),
            };
          }),
        });
      });

      if (videoFiles.length !== 20) {
        throw new Error(`视频数量不足20个，当前: ${videoFiles.length}`);
      }

      const outputDir = path.join(this.monitorDirectory, '视频去字幕任务');
      const outputFileName = `S1---${Date.now()}.mp4`;
      const outputPath = path.join(outputDir, outputFileName);

      this.emit('log', {
        message: `开始合并 ${videoFiles.length} 个视频`,
        type: 'info',
      } as LogEvent);

      await this.ffmpegUtil.concatVideos(videoFiles, outputPath);

      this.emit('log', {
        message: `视频合并成功: ${outputFileName} (总时长: 400秒)`,
        type: 'success',
      } as LogEvent);

      // 清空商品目录并重命名
      await this.cleanProductDirs(productDirs);
      await this.renameProductDirs(productDirs, 'S1---', 'S2---');
      this.emit('log', {
        message: `已清空商品目录并重命名`,
        type: 'info',
      } as LogEvent);

      this.emit('s1OkCallback', outputPath, videosChunk);
    } catch (error) {
      this.emit('log', {
        message: `视频合并失败: ${(error as Error).message}`,
        type: 'error',
      } as LogEvent);
    } finally {
      this.status.processingStatus = '空闲';
      this.updateStatus();
    }
  }

  /**
   * 拆分视频
   */
  public async splitVideo(videoPath: string): Promise<void> {
    this.status.processingStatus = '开始拆分视频';
    this.updateStatus();

    try {
      // const task = await workbenchManager.getTaskByKey(
      //   's3TasksQueue',
      //   videoPath
      // );
      // if (!task) {
      //   throw new Error(`视频 ${videoPath} 任务不存在`);
      // }
      const VideoSegment: VideoSegment[] = [];
      // const productDirs: string[] = [];
      // task.forEach(item => {
      //   productDirs.push(item.folderName);
      //   item.videos.forEach(video => {
      //     VideoSegment.push({
      //       fragmentDuration: video.fragmentDuration,
      //       filePath: path.join(
      //         item.folderName,
      //         video.fileName.replace('S2---', 'S3---')
      //       ),
      //     });
      //   });
      // });
      console.log('VideoSegment', VideoSegment);

      this.emit('log', {
        message: `视频 ${videoPath} 开始拆分`,
        type: 'info',
      } as LogEvent);

      await this.ffmpegUtil.splitVideoBySegments(videoPath, VideoSegment);

      // 删除文件并清除任务
      fs.unlinkSync(videoPath);
      // await workbenchManager.removeTask('s3TasksQueue', videoPath);

      // 重命名商品目录
      // await this.renameProductDirs(productDirs, 'S2---', 'S3---');

      this.emit('log', {
        message: `视频拆分成功: ${videoPath}`,
        type: 'success',
      } as LogEvent);
    } catch (error) {
      this.emit('log', {
        message: `视频拆分失败: ${(error as Error).message}`,
        type: 'error',
      } as LogEvent);
    } finally {
      this.status.processingStatus = '空闲';
      this.updateStatus();
    }
  }

  /**
   * 启动音频提取队列处理
   */
  private startAudioExtractQueueProcessing(): void {
    // 每2秒处理一个队列项目
    this.audioExtractInterval = setInterval(async () => {
      if (this.audioExtractQueue.length > 0) {
        const videoPath = this.audioExtractQueue.shift();
        if (videoPath) {
          await this.processAudioExtract(videoPath);
        }
      }
    }, 2000);
  }

  /**
   * 添加到音频提取队列
   */
  public addToAudioExtractQueue(videoPath: string): void {
    const normalizedPath = path.resolve(videoPath);

    // 检查是否已经在队列中
    if (!this.audioExtractQueue.includes(normalizedPath)) {
      this.audioExtractQueue.push(normalizedPath);
      this.emit('log', {
        message: `已加入音频提取队列: ${path.basename(
          normalizedPath
        )} (队列长度: ${this.audioExtractQueue.length})`,
        type: 'info',
      } as LogEvent);
    }
  }

  /**
   * 从音频提取队列中移除
   */
  public removeFromAudioExtractQueue(videoPath: string): void {
    const normalizedPath = path.resolve(videoPath);
    this.audioExtractQueue = this.audioExtractQueue.filter(
      path => path !== normalizedPath
    );
    this.emit('log', {
      message: `已从音频提取队列移除: ${path.basename(
        normalizedPath
      )} (剩余队列长度: ${this.audioExtractQueue.length})`,
      type: 'info',
    } as LogEvent);
  }

  /**
   * 处理音频提取
   */
  private async processAudioExtract(videoPath: string): Promise<void> {
    const fileKey = this.getFileKey(videoPath);

    // 检查是否正在处理
    if (this.currentlyProcessing.has(fileKey)) {
      return;
    }

    // 标记为处理中
    this.currentlyProcessing.add(fileKey);
    this.status.processingStatus = `提取音频中: ${path.basename(videoPath)}`;
    this.updateStatus();

    try {
      // 确保视频文件存在
      if (!fs.existsSync(videoPath)) {
        throw new Error('视频文件不存在');
      }

      // 创建音频输出目录
      const audioOutputDir = path.join(this.monitorDirectory, '音频输出');
      if (!fs.existsSync(audioOutputDir)) {
        fs.mkdirSync(audioOutputDir, { recursive: true });
      }

      // 生成输出音频文件名
      const baseName = path.basename(videoPath, path.extname(videoPath));
      const outputPath = path.resolve(audioOutputDir, `${baseName}.mp3`);

      // 提取音频
      await this.ffmpegUtil.extractAudio(path.resolve(videoPath), outputPath);

      this.emit('log', {
        message: `音频提取成功: ${path.basename(outputPath)}`,
        type: 'success',
      } as LogEvent);

      // 触发提取完成事件
      this.emit('audioExtractComplete', { inputPath: videoPath, outputPath });
    } catch (error) {
      this.emit('log', {
        message: `音频提取失败: ${path.basename(videoPath)} - ${
          (error as Error).message
        }`,
        type: 'error',
      } as LogEvent);
    } finally {
      this.currentlyProcessing.delete(fileKey);
      this.status.processingStatus = '空闲';
      this.updateStatus();
    }
  }

  /**
   * 清空商品目录
   */
  private async cleanProductDirs(productDirs: string[]): Promise<void> {
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
        this.emit('log', {
          message: `已清空目录: ${path.basename(dir)}`,
          type: 'info',
        } as LogEvent);
      } catch (error) {
        this.emit('log', {
          message: `处清空目录失败: ${path.basename(dir)} - ${
            (error as Error).message
          }`,
          type: 'error',
        } as LogEvent);
      }
    }
  }

  /**
   * 重命名商品目录
   */
  private async renameProductDirs(
    productDirs: string[],
    searchVal: string,
    replaceVal: string
  ): Promise<void> {
    for (const dir of productDirs) {
      try {
        // 重命名目录
        const newDirName = dir.replace(searchVal, replaceVal);
        fs.renameSync(dir, newDirName);

        this.emit('log', {
          message: `已重命名目录: ${path.basename(newDirName)}`,
          type: 'info',
        } as LogEvent);
      } catch (error) {
        this.emit('log', {
          message: `重命名目录失败: ${path.basename(dir)} - ${
            (error as Error).message
          }`,
          type: 'error',
        } as LogEvent);
      }
    }
  }

  /**
   * 工具方法
   */

  // 判断是否为视频文件
  private isVideoFile(filePath: string): boolean {
    return isVideoFile(filePath);
  }

  // 判断是否在商品目录中
  private isInProductDirectory(filePath: string): boolean {
    const dirName = path.dirname(filePath);
    const baseDir = path.basename(dirName);
    return (
      baseDir.startsWith('S1---') &&
      !path.basename(filePath).startsWith('S1---')
    );
  }

  // 判断是否为已处理的视频文件
  private isProcessedVideoFile(filePath: string): boolean {
    return isProcessedVideoFile(filePath);
  }

  // 检查文件是否正在处理
  private isFileBeingProcessed(fileKey: string): boolean {
    return (
      this.currentlyProcessing.has(fileKey) ||
      this.recentlyProcessed.has(fileKey)
    );
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
          return (
            fs.statSync(fullPath).isDirectory() && item.startsWith('S1---')
          );
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

  // 获取输出文件名 - 保留S1---前缀
  private async getOutputFileName(productDir: string): Promise<string> {
    const files = fs.readdirSync(productDir);
    const processedVideos = files.filter(
      file => file.endsWith('.mp4') && file.includes('---')
    );

    let maxNumber = 0;
    processedVideos.forEach(file => {
      const match = file.match(/---(\d+)\.mp4$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    });

    // 保留完整的目录名，包括 S1--- 前缀
    const productName = path.basename(productDir);
    return `${productName}---${maxNumber + 1}.mp4`;
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
        if (
          this.isVideoFile(filePath) &&
          !this.isProcessedVideoFile(filePath)
        ) {
          this.handleFileEvent(filePath, 'scan');
          foundCount++;
        }
      });
    });

    this.emit('log', {
      message: `扫描完成，发现 ${foundCount} 个待处理文件`,
      type: 'info',
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
      productDirs: this.getProductDirectories().length,
    };
  }
}

export default VideoProcessor;

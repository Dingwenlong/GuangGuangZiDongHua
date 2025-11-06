import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import FileWatcher from '../lib/file-watcher';
import {
  isVideoFile,
  isProcessedVideoFile,
  cleanProductDirs,
  renameProductDirs,
} from '../utils/file';
import { FFmpegUtil, FFmpegProgressEvent, VideoSegment } from '../lib/ffmpeg';
import { S3VideosChunk, type FolderItem } from './workbench-manager';
import { writeLog, type LogEvent } from '@main/utils/log';

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

class VideoProcessor extends EventEmitter {
  public monitorDirectory: string;
  private watcher: FileWatcher | null;
  private options: VideoProcessorOptions;
  private currentlyProcessing: Set<string>;
  private recentlyProcessed: Map<string, number>;
  private recentlyProcessedCleanup: NodeJS.Timeout | null;
  private processingQueue: Map<string, ProcessingQueueItem>;
  private status: StatusObject;
  private queueProcessInterval: NodeJS.Timeout | null = null;
  private ffmpegUtil: FFmpegUtil;

  // 去字幕任务队列
  private subtitleRemoveQueue: string[];

  // 存储视频路径对应的videosTable映射yong
  private videoToVideosTableMap: Map<string, string[][]>;
  // 字幕处理状态标记
  private isSubtitleProcessing: boolean;

  private shouldRunChecks: boolean = false;
  private checkPromise: Promise<void> | null = null;

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

    // 去字幕任务队列
    this.subtitleRemoveQueue = [];
    // 初始化视频路径到videosTable的映射
    this.videoToVideosTableMap = new Map<string, string[][]>();
    // 初始化字幕处理状态
    this.isSubtitleProcessing = false;

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
      this.writeLog(event.message, event.type);
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
      this.writeLog('监控目录不存在', 'error');
      return;
    }

    // 创建必要的子目录
    this.createSubdirectories();

    // 启动文件监控
    this.startFileWatching();

    // 定期检查合并条件
    this.startChecking();

    // 启动处理队列检查
    this.startQueueProcessing();

    // 启动去字幕队列检查
    this.startSubtitleQueueChecking();

    this.writeLog(
      `视频处理器已启动，监控目录: ${this.monitorDirectory}，文件标识方法: ${this.options.fileKeyMethod}`,
      'success'
    );
  }

  /**
   * 停止文件监控
   */
  public async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.stop();
      this.writeLog('文件监控已停止');
    }

    if (this.recentlyProcessedCleanup) {
      clearTimeout(this.recentlyProcessedCleanup);
    }

    if (this.queueProcessInterval) {
      clearInterval(this.queueProcessInterval);
    }
    this.shouldRunChecks = false;
    // 等待当前循环完成
    if (this.checkPromise) {
      await this.checkPromise;
      this.checkPromise = null;
    }

    this.status.monitoring = false;
    this.status.processingStatus = '已停止';
    this.updateStatus();

    this.writeLog('视频处理器已完全停止');
  }

  public updateWatchedDirectory(newDirectory: string): void {
    this.writeLog(`目录切换 ${this.monitorDirectory} --> ${newDirectory}`);
    this.monitorDirectory = newDirectory;
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
      this.startFileWatching();
    }
    // 创建必要的子目录
    this.createSubdirectories();
  }

  /**
   * 创建必要的子目录
   */
  private createSubdirectories(): void {
    const subtitleTaskDir = path.join(this.monitorDirectory, '视频去字幕任务');
    const tempDir = path.join(this.monitorDirectory, 'temp');
    const audioOutputDir = path.join(this.monitorDirectory, '音频输出');
    const storyboardDir = path.join(this.monitorDirectory, '视频分镜任务');

    [subtitleTaskDir, tempDir, audioOutputDir, storyboardDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.writeLog(`创建目录: ${dir}`);
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
        this.writeLog('文件监控系统就绪', 'success');

        // 扫描现有文件
        setTimeout(() => this.scanExistingFiles(), 5000);
      })
      .on('error', (error: Error) => {
        this.writeLog(`文件监控错误: ${error.message}`, 'error');
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
    if (await this.doneForVideoProcess(filePath)) {
      return;
    }

    // 基础检查
    if (!isVideoFile(filePath) || !this.isInProductDirectory(filePath)) {
      return;
    }

    if (isProcessedVideoFile(filePath)) {
      // 检查是否是处理后的视频文件
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
      this.writeLog(
        `处理文件事件失败: ${path.basename(filePath)} - ${
          (error as Error).message
        }`,
        'error'
      );
    }
  }

  private async doneForVideoProcess(filePath: string) {
    const fileName = path.basename(filePath);
    const fileDir = path.dirname(filePath);
    if (fileName === '0000.txt' && fileDir.indexOf('S1') > -1) {
      await renameProductDirs([fileDir], 'S1---', 'X1---');
      this.writeLog(`${fileDir}目录重命名为X1`);
      return true;
    }
    return false;
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

      this.writeLog(`文件已删除，清理处理状态: ${path.basename(filePath)}`);
    } catch (error) {
      this.writeLog(
        `处理文件删除时出错: ${path.basename(filePath)} - ${
          (error as Error).message
        }`,
        'warning'
      );
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

    this.writeLog(
      `已加入处理队列: ${path.basename(filePath)} (队列长度: ${
        this.processingQueue.size
      })`
    );
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

    this.writeLog(`开始处理视频: ${path.basename(filePath)}`);
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
        this.writeLog(
          `视频处理失败，已达到重试次数: ${path.basename(filePath)}`,
          'error'
        );
        this.processingQueue.delete(filePath);
      } else {
        this.writeLog(
          `视频处理失败，等待重试: ${path.basename(filePath)} (${
            queueItem.retryCount
          }/3)`,
          'warning'
        );
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
      this.writeLog(`视频时长: ${duration.toFixed(2)}秒`);
    } catch (error) {
      throw new Error(`无法获取视频时长: ${(error as Error).message}`);
    }

    if (duration < 16) {
      this.writeLog('视频时长小于16秒，无法处理', 'warning');
      return;
    }

    // 获取输出文件名 - 保留S1---前缀
    const outputFileName = await this.getOutputFileName(productDir);
    const outputPath = path.join(productDir, outputFileName);

    // // 根据时长处理视频
    // if (Math.abs(duration - 20) < 0.1) {
    //   this.writeLog(`[${inputPath}]视频时长正好20秒，无需处理`);

    //   if (inputPath.indexOf('---') === -1) {
    //     await fs.promises.rename(inputPath, outputPath);
    //   }
    //   return;
    // }

    this.status.processingStatus = `处理中: ${path.basename(inputPath)}`;
    this.updateStatus();

    try {
      if (duration >= 16 && duration <= 24) {
        const speed = duration / 21;
        await this.ffmpegUtil.adjustSpeed(inputPath, outputPath, speed);
      } else if (duration > 24) {
        await this.ffmpegUtil.trimVideo(inputPath, outputPath);
      }

      // 验证输出文件
      await this.ffmpegUtil.verifyOutputVideo(outputPath);

      // 删除原视频
      await fs.promises.unlink(inputPath);

      this.writeLog(
        `视频处理完成: ${outputFileName} (${duration.toFixed(2)}秒 → 20.00秒)`,
        'success'
      );
    } catch (error) {
      // 清理可能生成的不完整输出文件
      if (fs.existsSync(outputPath)) {
        await fs.promises.unlink(outputPath);
      }
      throw new Error(`视频处理失败: ${(error as Error).message}`);
    } finally {
      this.status.processingStatus = '空闲';
      this.updateStatus();
    }
  }

  private async startChecking(): Promise<void> {
    this.shouldRunChecks = true;
    this.checkPromise = this.checkLoop();
  }

  private async checkLoop(): Promise<void> {
    while (this.shouldRunChecks) {
      try {
        await this.checkMergeCondition();
      } catch (error) {
        this.writeLog(
          `检查合并条件时出错: ${(error as Error).message}`,
          'error'
        );
      }

      // 等待5秒
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
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
      this.writeLog(
        `满足合并条件: 商品目录${productDirs.length}个, 就绪目录${readyDirs.length}个`
      );
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
      const outputFileName = `S1---${Date.now()}.mp4`;
      const videosChunk = {
        videoFilePath: path.join(
          path.join(this.monitorDirectory, '视频去字幕任务'),
          outputFileName
        ),
        pathOfChains: [] as FolderItem[],
        subtitleRemoveOver: false,
      } as S3VideosChunk;

      const productDirs = this.getProductDirectories()
        .filter(dir => {
          const videos = this.getProcessedVideos(dir);
          return videos.length >= 4;
        })
        .sort((a, b) => {
          const stepPartsA = a.split('---');
          const stepPartsB = b.split('---');
          return stepPartsA[0] === stepPartsB[0]
            ? Number(stepPartsA[1]) - Number(stepPartsB[1])
            : stepPartsA[0].localeCompare(stepPartsB[0]);
        })
        .slice(0, 5);
      const allVideoFiles: string[] = [];
      productDirs.forEach(dir => {
        // 升序，取前四个
        const videoFiles = this.getProcessedVideos(dir).slice(0, 4);
        const pathOfChain = {
          folderName: dir,
          videos: videoFiles.map((video, index) => {
            return {
              fragmentDuration: 20,
              fileName: video.replace(dir, ''),
              fileNo: index + 1,
            };
          }),
        } satisfies FolderItem;
        videosChunk.pathOfChains.push(pathOfChain);
        allVideoFiles.push(...videoFiles);
      });

      if (allVideoFiles.length !== 20) {
        throw new Error(`视频数量不足20个，当前: ${allVideoFiles.length}`);
      }

      this.writeLog(`开始合并 ${allVideoFiles.length} 个视频`);
      await this.ffmpegUtil.concatVideos(
        allVideoFiles,
        videosChunk.videoFilePath
      );

      this.writeLog(
        `视频合并成功: ${outputFileName} (总时长: 400秒)`,
        'success'
      );

      // 清空S1商品目录并重命名为S2
      await cleanProductDirs(productDirs);
      this.writeLog(`已清空${productDirs}目录商品`);
      await renameProductDirs(productDirs, 'S1---', 'S2---');
      this.writeLog(`${productDirs}目录重命名为S2`);

      this.emit('s1OkCallback', videosChunk);
    } catch (error) {
      this.writeLog(`视频合并失败: ${(error as Error).message}`, 'error');
    } finally {
      this.status.processingStatus = '空闲';
      this.updateStatus();
    }
  }

  /**
   * 拆分视频
   */
  public async splitVideo(videosChunk: S3VideosChunk): Promise<void> {
    this.status.processingStatus = '开始拆分视频';
    this.updateStatus();

    try {
      const productDirs: string[] = [];
      const videoSegment: VideoSegment[] = [];
      const newPathOfChains: FolderItem[] = [];
      videosChunk.pathOfChains.forEach(item => {
        // 文件夹名改为S2后面执行完统一改为S3
        item.folderName = item.folderName.replace('S1---', 'S2---');
        productDirs.push(item.folderName);
        item.videos.forEach(video => {
          videoSegment.push({
            fragmentDuration: video.fragmentDuration,
            filePath: path.join(
              item.folderName,
              video.fileName.replace('S1---', 'S3---') // 文件名直接改为S3即可
            ),
          });
        });
        newPathOfChains.push({
          folderName: item.folderName.replace('S2---', 'S3---'),
          videos: item.videos.map(video => {
            video.fileName = video.fileName.replace('S1---', 'S3---');
            return video;
          }),
        } satisfies FolderItem);
      });

      this.writeLog(`视频 ${videosChunk.videoFilePath} 开始拆分`);

      await this.ffmpegUtil.splitVideoBySegments(
        videosChunk.videoFilePath,
        videoSegment
      );

      // 删除文件
      fs.unlinkSync(videosChunk.videoFilePath);
      // 重命名商品目录
      await renameProductDirs(productDirs, 'S2---', 'S3---');
      this.writeLog(`${productDirs}目录重命名为S3`);

      this.writeLog(
        `视频 ${videosChunk.videoFilePath} 拆分成功: ${videosChunk.videoFilePath}`,
        'success'
      );

      this.emit('s3OkCallback', newPathOfChains);
    } catch (error) {
      this.writeLog(
        `视频 ${videosChunk.videoFilePath} 拆分失败: ${
          (error as Error).message
        }`,
        'error'
      );
    } finally {
      this.status.processingStatus = '空闲';
      this.updateStatus();
    }
  }

  /**
   * 删除去字幕处理队列的某项
   */
  public removeToSubtitleRemoveQueue(videoPath: string): void {
    this.subtitleRemoveQueue = this.subtitleRemoveQueue.filter(
      x => x !== videoPath
    );
    // 同时从映射中删除对应的videosTable
    if (this.videoToVideosTableMap.has(videoPath)) {
      this.videoToVideosTableMap.delete(videoPath);
    }

    this.writeLog(
      `已删除去字幕队列项: ${path.basename(videoPath)} (剩余队列长度: ${
        this.subtitleRemoveQueue.length
      })`
    );
  }

  /**
   * 启动去字幕队列检查
   */
  private async startSubtitleQueueChecking(): Promise<void> {
    try {
      // 执行检查
      if (this.subtitleRemoveQueue.length > 0 && !this.isSubtitleProcessing) {
        const videoPath = this.subtitleRemoveQueue[0]; // 获取队列中的第一个视频路径

        // 从映射中获取对应的videosTable，如果不存在则使用空二维数组
        const videosTable: string[][] =
          this.videoToVideosTableMap.get(videoPath) || [];

        this.writeLog(`准备处理字幕队列中的视频: ${path.basename(videoPath)}`);

        // 触发队列处理事件，传递正确的参数
        this.emit(
          'addToSubtitleRemoveQueue',
          videoPath,
          [...this.subtitleRemoveQueue], // 传递队列副本
          videosTable
        );
      }
    } catch (error) {
      this.writeLog(`检查字幕队列时出错: ${(error as Error).message}`, 'error');
    } finally {
      // 等待3秒后再次执行
      setTimeout(() => {
        this.startSubtitleQueueChecking();
      }, 3000);
    }
  }

  /**
   * 工具方法
   */

  // 判断是否在商品目录中
  private isInProductDirectory(filePath: string): boolean {
    const dirName = path.dirname(filePath);
    const baseDir = path.basename(dirName);
    return (
      baseDir.startsWith('S1---') &&
      !path.basename(filePath).startsWith('S1---')
    );
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
    return new Promise(async (resolve, reject) => {
      let size = 0;
      let stableCount = 0;
      const startTime = Date.now();

      const check = async (): Promise<void> => {
        if (Date.now() - startTime > timeout) {
          reject(new Error('文件稳定等待超时'));
          return;
        }

        try {
          const stats = await fs.promises.stat(filePath);
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

      await check();
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
    this.writeLog('开始扫描现有文件');

    const productDirs = this.getProductDirectories();
    let foundCount = 0;

    productDirs.forEach(dir => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        if (isVideoFile(filePath) && !isProcessedVideoFile(filePath)) {
          this.handleFileEvent(filePath, 'scan');
          foundCount++;
        }
      });
    });
    this.writeLog(`扫描完成，发现 ${foundCount} 个待处理文件`);
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

  // 获取系统状态
  public getStatus(): StatusObject {
    return this.status;
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

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}

export default VideoProcessor;

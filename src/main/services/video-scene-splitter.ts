// video-scene-splitter.ts
import * as fs from 'fs';
import * as path from 'path';
import { FFmpegUtil } from '../lib/ffmpeg';
import EventEmitter from 'events';
import { writeLog, type LogEvent } from '@main/utils/log';
import type { S4VideosChunk } from './workbench-manager';
import {
  insertDirectoryBeforeLast,
  removeFilesByPrefix,
  renameProductDir,
} from '@main/utils/file';

/**
 * 视频场景分割配置选项
 */
export interface VideoSceneSplitterOptions {
  /** 初始片段长度（秒），默认4秒 */
  initialLength?: number;
  /** 场景变化检查时长（秒），默认2秒 */
  lookahead?: number;
  /** 扩展后的片段长度（秒），默认5秒 */
  extendedLength?: number;
  /** 最大片段数量，默认4个 */
  maxSegments?: number;
  /** 场景变化检测阈值（0-1），值越小越敏感，默认0.3 */
  sceneThreshold?: number;
  /** 是否重新编码输出片段，默认true（确保时长准确） */
  reencode?: boolean;
}

/**
 * 视频场景分割结果
 */
export interface SplitResult {
  /** 生成的片段文件路径数组 */
  segments: string[];
  /** 原始视频总时长（秒） */
  originalDuration: number;
  /** 分割后的总时长（秒） */
  totalSegmentsDuration: number;
  /** 输出目录 */
  outputDir: string;
}

/**
 * 视频场景分割工具类
 * 功能：将视频按场景分割，先截取4秒，检查后续2秒是否有场景变化，
 *       如果没有变化则延长至5秒，最多分割4个片段
 */

export class VideoSceneSplitter extends EventEmitter {
  private ffmpegUtil: FFmpegUtil;

  constructor() {
    super();
    this.ffmpegUtil = FFmpegUtil.getInstance();
    this.setupFFmpegEvents();
  }

  /**
   * 设置FFmpeg事件监听
   */
  private setupFFmpegEvents(): void {
    this.ffmpegUtil.on('log', (event: LogEvent) => {
      this.writeLog(event.message, event.type);
    });
  }

  public async workflow(
    videosChunk: S4VideosChunk,
    options?: VideoSceneSplitterOptions
  ) {
    videosChunk.childFolders = [];

    // -----------视频切片---------
    this.writeLog(`开始执行视频切片任务${videosChunk.folderName}`);
    for (const video of videosChunk.videos) {
      const videoPath = videosChunk.folderName + video.fileName;
      const outputDir = `${insertDirectoryBeforeLast(
        videosChunk.folderName,
        '视频分镜任务'
      )}---${video.fileNo}`;

      const splitResult = await this.split(videoPath, outputDir, options);
      if (splitResult)
        videosChunk.childFolders.push({
          folderName: outputDir,
          videos: splitResult.segments.map((segment, i) => {
            return {
              fileName: segment.replace(outputDir + '\\', ''),
              fragmentDuration: 0,
              fileNo: i + 1,
            };
          }),
        });
    }

    // -----------混剪---------
    this.writeLog(`开始执行视频混剪任务${videosChunk.folderName}`);
    // 混剪视频1：1-scene_1 + 2-scene_2 + 3-scene_3 + 4-scene_4
    const montage1: string[] = new Array(4).fill('');
    // 混剪视频2：2-scene_1 + 1-scene_2 + 4-scene_3 + 3-scene_4
    const montage2: string[] = new Array(4).fill('');
    // 混剪视频3：3-scene_1 + 4-scene_2 + 1-scene_3 + 2-scene_4
    const montage3: string[] = new Array(4).fill('');
    // 混剪视频4：4-scene_1 + 3-scene_2 + 2-scene_3 + 1-scene_4
    const montage4: string[] = new Array(4).fill('');
    videosChunk.childFolders.forEach(childFolder => {
      const endChar = childFolder.folderName.slice(-1);
      switch (endChar) {
        case '1':
          childFolder.videos.forEach(video => {
            const scenePath = path.join(childFolder.folderName, video.fileName);
            // 1-1
            if (video.fileNo === 1) montage1[0] = scenePath;
            // 1-2
            if (video.fileNo === 2) montage2[1] = scenePath;
            // 1-3
            if (video.fileNo === 3) montage3[2] = scenePath;
            // 1-4
            if (video.fileNo === 4) montage4[3] = scenePath;
          });
          break;
        case '2':
          childFolder.videos.forEach(video => {
            const scenePath = path.join(childFolder.folderName, video.fileName);
            // 2-1
            if (video.fileNo === 1) montage2[0] = scenePath;
            // 2-2
            if (video.fileNo === 2) montage1[1] = scenePath;
            // 2-3
            if (video.fileNo === 3) montage4[2] = scenePath;
            // 2-4
            if (video.fileNo === 4) montage3[3] = scenePath;
          });
          break;
        case '3':
          childFolder.videos.forEach(video => {
            const scenePath = path.join(childFolder.folderName, video.fileName);
            // 3-1
            if (video.fileNo === 1) montage3[0] = scenePath;
            // 3-2
            if (video.fileNo === 2) montage4[1] = scenePath;
            // 3-3
            if (video.fileNo === 3) montage1[2] = scenePath;
            // 3-4
            if (video.fileNo === 4) montage2[3] = scenePath;
          });
          break;
        case '4':
          childFolder.videos.forEach(video => {
            const scenePath = path.join(childFolder.folderName, video.fileName);
            // 4-1
            if (video.fileNo === 1) montage4[0] = scenePath;
            // 4-2
            if (video.fileNo === 2) montage3[1] = scenePath;
            // 4-3
            if (video.fileNo === 3) montage2[2] = scenePath;
            // 4-4
            if (video.fileNo === 4) montage1[3] = scenePath;
          });
          break;
        default:
          break;
      }
    });
    const montages = [montage1, montage2, montage3, montage4];
    console.log('montages', montages);
    const videos: string[] = [];
    let i = 1;
    for (const montage of montages) {
      const newFolderName = videosChunk.folderName.replace('S3---', 'S4---');
      const outFileName = `${path.basename(newFolderName)}---${i}${path.extname(
        montage[0]
      )}`;
      // 当前文件路径
      await this.montage(
        montage,
        path.join(videosChunk.folderName, outFileName)
      );
      // 为下一步提供的文件路径
      videos.push(path.join(newFolderName, outFileName));
      i++;
    }
    // 删除S3---开头的视频
    const removedFiles = removeFilesByPrefix(
      [videosChunk.folderName],
      'S3---',
      {
        recursive: true,
      }
    );
    this.writeLog(
      `${videosChunk.folderName}目录已删除S3开头的视频(${removedFiles})`
    );
    // 商品目录的 S3 改为 S4
    await renameProductDir(videosChunk.folderName, 'S3---', 'S4---');
    this.writeLog(`${videosChunk.folderName}目录已重命名为S4`);
    this.emit('s4OkCallback', videos);
    this.writeLog(`视频混剪任务混剪完成${videosChunk.folderName}`);
  }

  /**
   * 视频场景分割
   * @param videoPath 输入视频文件路径
   * @param outputDir 输出目录
   * @param options 分割配置选项
   * @returns 分割结果
   */
  public async split(
    videoPath: string,
    outputDir: string = '',
    options: VideoSceneSplitterOptions = {}
  ): Promise<SplitResult | null> {
    try {
      // 合并配置
      const config: Required<VideoSceneSplitterOptions> = {
        initialLength: options.initialLength ?? 4,
        lookahead: options.lookahead ?? 2,
        extendedLength: options.extendedLength ?? 5,
        maxSegments: options.maxSegments ?? 4,
        sceneThreshold: options.sceneThreshold ?? 0.3,
        reencode: options.reencode ?? true,
      };

      // 验证输入文件
      this.checkVideoFileExists(videoPath);

      // 获取视频信息
      const videoDuration = await this.ffmpegUtil.getVideoDuration(videoPath);
      const hasAudio = await this.ffmpegUtil.hasAudioStream(videoPath);

      // 设置输出目录
      const finalOutputDir =
        outputDir || path.join(path.dirname(videoPath), 'scene_clips');

      // 创建输出目录
      try {
        fs.mkdirSync(finalOutputDir, { recursive: true });
      } catch (error) {
        throw new Error(`无法创建输出目录: ${finalOutputDir}`);
      }

      this.writeLog(
        `视频 ${videoPath} 开始分割处理，输出目录: ${finalOutputDir}，视频时长: ${videoDuration}秒`,
        'info'
      );
      console.log(`[VideoSceneSplitter] 配置:`, config);

      const segments: string[] = [];
      let currentTime = 0;
      let segmentCount = 0;

      // 生成基础文件名
      const baseName = path.parse(videoPath).name;

      // 主处理循环
      while (currentTime < videoDuration && segmentCount < config.maxSegments) {
        const remainingTime = videoDuration - currentTime;

        // 判断是否为最后一个片段
        const isLastSegment = segmentCount + 1 === config.maxSegments;

        let segmentDuration: number;

        if (isLastSegment) {
          // 最后一个片段：使用剩余所有时间
          segmentDuration = remainingTime;
        } else if (remainingTime <= config.initialLength) {
          // 剩余时间不足初始长度
          segmentDuration = remainingTime;
        } else {
          // 正常处理逻辑
          segmentDuration = config.initialLength;

          // 检查是否有足够的时间进行场景检测
          if (remainingTime >= config.initialLength + config.lookahead) {
            const sceneCheckStart = currentTime + config.initialLength;

            try {
              const hasSceneChange = await this.ffmpegUtil.detectSceneChange(
                videoPath,
                sceneCheckStart,
                config.lookahead,
                config.sceneThreshold
              );

              if (!hasSceneChange) {
                // 没有场景变化，延长片段
                segmentDuration = Math.min(
                  config.extendedLength,
                  remainingTime
                );
              }
            } catch {}
          }
        }

        // 确保不超出视频时长
        if (currentTime + segmentDuration > videoDuration) {
          segmentDuration = videoDuration - currentTime;
        }

        // 生成输出文件名
        const outputFileName = `scene_${String(segmentCount + 1).padStart(
          2,
          '0'
        )}.mp4`;
        const outputPath = path.join(finalOutputDir, outputFileName);

        // 提取片段
        try {
          await this.ffmpegUtil.extractSegment(
            videoPath,
            currentTime,
            segmentDuration,
            outputPath,
            hasAudio,
            config.reencode
          );

          segments.push(outputPath);
          segmentCount++;
          currentTime += segmentDuration;
        } catch (error) {
          throw new Error(`提取片段失败: ${error}`);
        }

        // 检查是否到达视频结尾
        if (currentTime >= videoDuration) {
          break;
        }
      }

      // 计算总片段时长
      let totalSegmentsDuration = 0;
      for (const segmentPath of segments) {
        const duration = await this.ffmpegUtil.verifySegmentDuration(
          segmentPath
        );
        totalSegmentsDuration += duration;
      }

      // 构建结果
      const result: SplitResult = {
        segments,
        originalDuration: videoDuration,
        totalSegmentsDuration,
        outputDir: finalOutputDir,
      };

      this.writeLog(
        `视频 ${videoPath} 分割完成! 原始视频时长: ${videoDuration}秒，生成片段数: ${segments.length}，片段总时长: ${totalSegmentsDuration}秒`,
        'info'
      );

      return result;
    } catch (error) {
      this.writeLog(`视频 ${videoPath} 分割失败! ${error}`, 'error');
      console.error('分割失败:', error);
    }
    return null;
  }

  /**
   * 蒙太奇（混剪）
   */
  public async montage(allVideoFiles: string[], outputPath: string) {
    this.writeLog(`开始混剪 ${allVideoFiles}-->${outputPath}`);
    await this.ffmpegUtil.concatVideos(allVideoFiles, outputPath);
    this.writeLog(`视频混剪成功: ${outputPath}`, 'success');
  }

  /**
   * 检查视频文件是否存在且可访问
   */
  private checkVideoFileExists(videoPath: string): void {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`视频文件不存在: ${videoPath}`);
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

// 默认导出
export default VideoSceneSplitter;

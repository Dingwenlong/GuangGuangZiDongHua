// video-scene-splitter.ts
import * as fs from 'fs';
import * as path from 'path';
import { FFmpegUtil } from '../lib/ffmpeg';
import EventEmitter from 'events';
import { writeLog, type LogEvent } from '@main/utils/log';

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
  /** ffmpeg可执行文件路径，默认使用系统PATH中的ffmpeg */
  ffmpegPath?: string;
  /** ffprobe可执行文件路径，默认使用系统PATH中的ffprobe */
  ffprobePath?: string;
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

  constructor(options: VideoSceneSplitterOptions = {}) {
    super();
    this.ffmpegUtil = FFmpegUtil.getInstance();
  }

  /**
   * 检查视频文件是否存在且可访问
   */
  private checkVideoFileExists(videoPath: string): void {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`视频文件不存在: ${videoPath}`);
    }
  }

  /**
   * 主方法：执行视频场景分割
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
        ffmpegPath: options.ffmpegPath || 'ffmpeg',
        ffprobePath: options.ffprobePath || 'ffprobe',
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
      this.emit('s4-1OkCallback', result);

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
  public async montage() {
    this.emit('s4-2OkCallback');
  }

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    writeLog.call(this, message, type);
  }
}

// 默认导出
export default VideoSceneSplitter;

// video-scene-splitter.ts
import * as fs from 'fs';
import * as path from 'path';
import { FFmpegUtil } from '../lib/ffmpeg';
import EventEmitter from 'events';

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
  /** 是否启用调试模式，默认false */
  debug?: boolean;
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
  private debug: boolean;

  constructor(options: VideoSceneSplitterOptions = {}) {
    super();
    this.ffmpegUtil = FFmpegUtil.getInstance();
    this.debug = options.debug || false;
    this.ffmpegUtil.setDebugMode(this.debug);
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
  public async splitVideo(
    videoPath: string,
    outputDir: string = '',
    options: VideoSceneSplitterOptions = {}
  ): Promise<SplitResult> {
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
      debug: options.debug ?? this.debug,
    };

    // 更新调试模式
    this.debug = config.debug;
    this.ffmpegUtil.setDebugMode(this.debug);

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

    if (this.debug) {
      console.log(`[VideoSceneSplitter] 开始视频分割处理`);
      console.log(`[VideoSceneSplitter] 输入视频: ${videoPath}`);
      console.log(`[VideoSceneSplitter] 输出目录: ${finalOutputDir}`);
      console.log(`[VideoSceneSplitter] 视频时长: ${videoDuration}秒`);
      console.log(`[VideoSceneSplitter] 配置:`, config);
    }

    const segments: string[] = [];
    let currentTime = 0;
    let segmentCount = 0;

    // 生成基础文件名
    const baseName = path.parse(videoPath).name;

    // 主处理循环
    while (currentTime < videoDuration && segmentCount < config.maxSegments) {
      const remainingTime = videoDuration - currentTime;

      if (this.debug) {
        console.log(
          `[VideoSceneSplitter] 处理片段 ${
            segmentCount + 1
          }, 当前位置: ${currentTime}秒, 剩余: ${remainingTime}秒`
        );
      }

      // 判断是否为最后一个片段
      const isLastSegment = segmentCount + 1 === config.maxSegments;

      let segmentDuration: number;

      if (isLastSegment) {
        // 最后一个片段：使用剩余所有时间
        segmentDuration = remainingTime;
        if (this.debug) {
          console.log(
            `[VideoSceneSplitter] 最后一个片段，使用剩余时间: ${segmentDuration}秒`
          );
        }
      } else if (remainingTime <= config.initialLength) {
        // 剩余时间不足初始长度
        segmentDuration = remainingTime;
        if (this.debug) {
          console.log(
            `[VideoSceneSplitter] 剩余时间不足，使用: ${segmentDuration}秒`
          );
        }
      } else {
        // 正常处理逻辑
        segmentDuration = config.initialLength;

        // 检查是否有足够的时间进行场景检测
        if (remainingTime >= config.initialLength + config.lookahead) {
          const sceneCheckStart = currentTime + config.initialLength;

          if (this.debug) {
            console.log(
              `[VideoSceneSplitter] 检查场景变化: ${sceneCheckStart}到${
                sceneCheckStart + config.lookahead
              }秒`
            );
          }

          try {
            const hasSceneChange = await this.ffmpegUtil.detectSceneChange(
              videoPath,
              sceneCheckStart,
              config.lookahead,
              config.sceneThreshold
            );

            if (!hasSceneChange) {
              // 没有场景变化，延长片段
              segmentDuration = Math.min(config.extendedLength, remainingTime);
              if (this.debug) {
                console.log(
                  `[VideoSceneSplitter] 无场景变化，延长片段至: ${segmentDuration}秒`
                );
              }
            } else {
              if (this.debug) {
                console.log(
                  `[VideoSceneSplitter] 检测到场景变化，保持片段长度: ${segmentDuration}秒`
                );
              }
            }
          } catch (error) {
            if (this.debug) {
              console.warn(
                `[VideoSceneSplitter] 场景检测失败，使用默认长度: ${error}`
              );
            }
            // 场景检测失败时保守处理，使用初始长度
          }
        } else {
          if (this.debug) {
            console.log(
              `[VideoSceneSplitter] 剩余时间不足以进行场景检测，使用初始长度`
            );
          }
        }
      }

      // 确保不超出视频时长
      if (currentTime + segmentDuration > videoDuration) {
        segmentDuration = videoDuration - currentTime;
        if (this.debug) {
          console.log(
            `[VideoSceneSplitter] 调整片段时长以避免超出: ${segmentDuration}秒`
          );
        }
      }

      // 生成输出文件名
      const outputFileName = `scene_${String(segmentCount + 1).padStart(
        2,
        '0'
      )}.mp4`;
      const outputPath = path.join(finalOutputDir, outputFileName);

      if (this.debug) {
        console.log(
          `[VideoSceneSplitter] 提取片段 ${segmentCount + 1}: ${currentTime}到${
            currentTime + segmentDuration
          }秒`
        );
      }

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

        // 验证片段时长
        const actualDuration = await this.ffmpegUtil.verifySegmentDuration(
          outputPath
        );
        if (this.debug) {
          console.log(`[VideoSceneSplitter] 片段实际时长: ${actualDuration}秒`);
        }

        segments.push(outputPath);
        segmentCount++;
        currentTime += segmentDuration;
      } catch (error) {
        throw new Error(`提取片段失败: ${error}`);
      }

      // 分隔线
      if (this.debug) {
        console.log(`[VideoSceneSplitter] ---`);
      }

      // 检查是否到达视频结尾
      if (currentTime >= videoDuration) {
        if (this.debug) {
          console.log(`[VideoSceneSplitter] 已到达视频结尾`);
        }
        break;
      }
    }

    // 计算总片段时长
    let totalSegmentsDuration = 0;
    for (const segmentPath of segments) {
      const duration = await this.ffmpegUtil.verifySegmentDuration(segmentPath);
      totalSegmentsDuration += duration;
    }

    // 构建结果
    const result: SplitResult = {
      segments,
      originalDuration: videoDuration,
      totalSegmentsDuration,
      outputDir: finalOutputDir,
    };

    if (this.debug) {
      console.log(`[VideoSceneSplitter] 分割完成!`);
      console.log(`[VideoSceneSplitter] 生成片段数: ${segments.length}`);
      console.log(`[VideoSceneSplitter] 原始视频时长: ${videoDuration}秒`);
      console.log(
        `[VideoSceneSplitter] 片段总时长: ${totalSegmentsDuration}秒`
      );
      console.log(`[VideoSceneSplitter] 输出文件:`);
      segments.forEach(segment => {
        console.log(`[VideoSceneSplitter]   ${path.basename(segment)}`);
      });
    }

    return result;
  }
}

// 默认导出
export default VideoSceneSplitter;

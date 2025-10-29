import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { FFmpegUtil, FFmpegProgressEvent } from '../lib/ffmpeg';

interface LogEvent {
  message: string;
  type: 'info' | 'error' | 'success' | 'warning' | 'debug';
}

interface AudioExtractResult {
  inputPath: string;
  outputPath: string;
}

interface StatusObject {
  processingStatus: string;
}

class AudioExtractor extends EventEmitter {
  private status: StatusObject;
  private ffmpegUtil: FFmpegUtil;
  private monitorDirectory: string;

  constructor(monitorDirectory: string = '') {
    super();
    this.monitorDirectory = monitorDirectory;

    this.status = {
      processingStatus: '空闲',
    };

    this.ffmpegUtil = FFmpegUtil.getInstance();
  }

  /**
   * 设置监控目录
   */
  public setMonitorDirectory(directory: string): void {
    this.monitorDirectory = directory;
  }

  /**
   * 处理音频提取
   */
  public async extractAudio(videoPath: string): Promise<AudioExtractResult> {
    this.emit('log', {
      message: `开始提取音频: ${path.basename(videoPath)}`,
      type: 'info',
    } as LogEvent);
    this.status.processingStatus = `提取音频中: ${path.basename(videoPath)}`;
    // this.emit('status', this.status);

    try {
      // 确保视频文件存在
      if (!fs.existsSync(videoPath)) {
        throw new Error('视频文件不存在');
      }

      // 生成输出音频文件名，直接保存在视频所在目录
      const videoDir = path.dirname(videoPath);
      const baseName = path.basename(videoPath, path.extname(videoPath));
      const outputPath = path.resolve(videoDir, `${baseName}.mp3`);

      // 提取音频
      await this.ffmpegUtil.extractAudio(path.resolve(videoPath), outputPath);

      this.emit('log', {
        message: `音频提取成功: ${path.basename(outputPath)}`,
        type: 'success',
      } as LogEvent);

      // 触发提取完成事件
      const result: AudioExtractResult = { inputPath: videoPath, outputPath };
      // this.emit('audioExtractComplete', result);
      // this.emit('s5OkCallback', result); // s5完成回调

      return result;
    } catch (error) {
      this.emit('log', {
        message: `音频提取失败: ${path.basename(videoPath)} - ${
          (error as Error).message
        }`,
        type: 'error',
      } as LogEvent);
      throw error;
    } finally {
      this.status.processingStatus = '空闲';
      // this.emit('status', this.status);
    }
  }

  /**
   * 获取当前状态
   */
  public getStatus(): StatusObject {
    return { ...this.status };
  }
}

export default AudioExtractor;

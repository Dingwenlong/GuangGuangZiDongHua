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
      this.emit('status', this.status);
    });

    // this.ffmpegUtil.on('log', (event: LogEvent) => {
    //   this.emit('log', event);
    // });
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
    this.status.processingStatus = `提取音频中: ${path.basename(videoPath)}`;
    this.emit('status', this.status);

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
      this.emit('status', this.status);
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

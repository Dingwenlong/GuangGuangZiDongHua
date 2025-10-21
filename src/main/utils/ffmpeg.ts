import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { platform } from 'os';

export interface FFmpegProgressEvent {
  progress: number;
  operation: string;
}

export class FFmpegUtil extends EventEmitter {
  private static instance: FFmpegUtil;
  private ffmpegPath!: string;
  private ffprobePath!: string;

  private constructor() {
    super();
    this.setupPaths();
  }

  public static getInstance(): FFmpegUtil {
    if (!FFmpegUtil.instance) {
      FFmpegUtil.instance = new FFmpegUtil();
    }
    return FFmpegUtil.instance;
  }

  private setupPaths(): void {
    const isWindows = platform() === 'win32';
    const ext = isWindows ? '.exe' : '';

    // 开发环境路径 - 项目根目录下的 resources 文件夹
    const devResourcesPath = path.join(process.cwd(), 'resources');
    const devFFmpegPath = path.join(devResourcesPath, `ffmpeg${ext}`);
    const devFFprobePath = path.join(devResourcesPath, `ffprobe${ext}`);

    // 生产环境路径 - Electron 的 resources 目录
    const prodResourcesPath = process.resourcesPath || '';
    const prodFFmpegPath = path.join(prodResourcesPath, `ffmpeg${ext}`);
    const prodFFprobePath = path.join(prodResourcesPath, `ffprobe${ext}`);

    // 设置 ffmpeg 路径
    if (fs.existsSync(devFFmpegPath)) {
      this.ffmpegPath = devFFmpegPath;
    } else if (fs.existsSync(prodFFmpegPath)) {
      this.ffmpegPath = prodFFmpegPath;
    } else {
      // 尝试使用系统 PATH 中的 ffmpeg
      this.ffmpegPath = 'ffmpeg';
      console.warn('使用系统 PATH 中的 ffmpeg');
    }

    // 设置 ffprobe 路径
    if (fs.existsSync(devFFprobePath)) {
      this.ffprobePath = devFFprobePath;
    } else if (fs.existsSync(prodFFprobePath)) {
      this.ffprobePath = prodFFprobePath;
    } else {
      // 尝试使用系统 PATH 中的 ffprobe
      this.ffprobePath = 'ffprobe';
      console.warn('使用系统 PATH 中的 ffprobe');
    }

    // 设置 fluent-ffmpeg 路径
    if (this.ffmpegPath !== 'ffmpeg') {
      ffmpeg.setFfmpegPath(this.ffmpegPath);
    }
    if (this.ffprobePath !== 'ffprobe') {
      ffmpeg.setFfprobePath(this.ffprobePath);
    }

    console.log(`FFmpeg 路径: ${this.ffmpegPath}`);
    console.log(`FFprobe 路径: ${this.ffprobePath}`);
  }

  /**
   * 获取视频时长
   */
  public getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new Error(`获取视频时长失败: ${err.message}`));
          return;
        }

        const duration = metadata.format.duration;
        if (!duration) {
          reject(new Error('无法从视频元数据中获取时长'));
          return;
        }

        resolve(duration);
      });
    });
  }

  /**
   * 调整视频速度
   */
  public adjustSpeed(
    inputPath: string,
    outputPath: string,
    speed: number,
    operationName = '变速处理'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          `-vf setpts=${1/speed}*PTS`,
          `-af atempo=${speed > 2 ? 2 : speed}`,
          ...(speed > 2 ? ['-af', `atempo=${speed/2}`] : []),
          '-t 20',
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k'
        ])
        .output(outputPath);

      this.runCommand(command, operationName)
        .then(() => resolve())
        .catch(reject);
    });
  }

  /**
   * 截取视频前20秒
   */
  public trimVideo(
    inputPath: string,
    outputPath: string,
    operationName = '截取处理'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          '-t 20',
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k'
        ])
        .output(outputPath);

      this.runCommand(command, operationName)
        .then(() => resolve())
        .catch(reject);
    });
  }

  /**
   * 合并视频文件
   */
  public concatVideos(
    videoFiles: string[],
    outputPath: string,
    operationName = '合并进度'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 创建临时目录
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // 创建临时转码文件列表
      const transcodedFiles: string[] = [];
      let processedCount = 0;

      // 转码所有视频为统一参数
      const transcodePromises = videoFiles.map((file, index) => {
        return new Promise<void>((resolveTranscode, rejectTranscode) => {
          const transcodedPath = path.join(tempDir, `transcoded_${index}.mp4`);
          transcodedFiles.push(transcodedPath);

          // 转码为统一参数
          ffmpeg(file)
            .outputOptions([
              '-c:v libx264',      // 视频编码器
              '-preset fast',      // 编码速度
              '-crf 23',           // 质量参数
              '-c:a aac',          // 音频编码器
              '-b:a 128k',         // 音频比特率
              '-vf scale=1280:720', // 统一分辨率
              '-r 30',             // 统一帧率
              '-movflags +faststart' // 优化网络播放
            ])
            .output(transcodedPath)
            .on('end', () => {
              processedCount++;
              this.emit('progress', {
                progress: (processedCount / videoFiles.length) * 50, // 转码占50%进度
                operation: `${operationName} - 转码中`
              });
              resolveTranscode();
            })
            .on('error', (err) => {
              rejectTranscode(new Error(`转码视频失败: ${err.message}`));
            })
            .run();
        });
      });

      // 所有视频转码完成后合并
      Promise.all(transcodePromises)
        .then(() => {
          // 创建 concat 列表文件
          const listPath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
          const listContent = transcodedFiles.map(file => `file '${path.resolve(file)}'`).join('\n');

          try {
            fs.writeFileSync(listPath, listContent);
          } catch (error) {
            reject(new Error(`创建列表文件失败: ${(error as Error).message}`));
            return;
          }

          // 执行合并命令
          const command = ffmpeg()
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions(['-c copy']) // 使用copy模式，因为已经统一编码
            .output(outputPath);

          this.runCommand(command, operationName)
            .then(() => {
              // 清理临时文件
              try {
                if (fs.existsSync(listPath)) {
                  fs.unlinkSync(listPath);
                }
                transcodedFiles.forEach(file => {
                  if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                  }
                });
              } catch (e) {
                console.warn('清理临时文件失败:', e);
              }
              resolve();
            })
            .catch((error) => {
              // 清理临时文件
              try {
                if (fs.existsSync(listPath)) {
                  fs.unlinkSync(listPath);
                }
                transcodedFiles.forEach(file => {
                  if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                  }
                });
              } catch (e) {
                console.warn('清理临时文件失败:', e);
              }
              reject(error);
            });
        })
        .catch(reject);
    });
  }

  /**
   * 验证输出视频
   */
  public verifyOutputVideo(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getVideoDuration(filePath)
        .then(duration => {
          if (Math.abs(duration - 20) > 1) {
            reject(new Error(`输出视频时长异常: ${duration}秒`));
          } else {
            resolve();
          }
        })
        .catch(reject);
    });
  }

  /**
   * 执行FFmpeg命令并处理进度
   */
  private runCommand(command: ffmpeg.FfmpegCommand, operationName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      command
        .on('start', (commandLine) => {
          this.emit('log', {
            message: `执行FFmpeg命令: ${commandLine}`,
            type: 'debug'
          });
        })
        .on('progress', (progress) => {
          // 计算进度百分比
          const percent = progress.percent || 0;
          this.emit('progress', {
            progress: percent,
            operation: operationName
          });
        })
        .on('end', () => {
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`FFmpeg处理失败: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * 提取视频音频
   */
  public extractAudio(
    inputPath: string,
    outputPath: string,
    operationName = '音频分离'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          '-acodec mp3', // 使用MP3编码器
          '-b:a 192k' // 设置音频比特率
        ])
        .output(outputPath);

      this.runCommand(command, operationName)
        .then(() => resolve())
        .catch(reject);
    });
  }
}

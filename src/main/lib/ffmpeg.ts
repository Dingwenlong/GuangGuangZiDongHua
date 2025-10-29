import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { platform } from 'os';
import { spawn, spawnSync } from 'child_process';

export interface FFmpegProgressEvent {
  progress: number;
  operation: string;
}

export interface VideoSegment {
  fragmentDuration: number;
  filePath: string;
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
    }

    // 设置 ffprobe 路径
    if (fs.existsSync(devFFprobePath)) {
      this.ffprobePath = devFFprobePath;
    } else if (fs.existsSync(prodFFprobePath)) {
      this.ffprobePath = prodFFprobePath;
    } else {
      // 尝试使用系统 PATH 中的 ffprobe
      this.ffprobePath = 'ffprobe';
    }

    // 设置 fluent-ffmpeg 路径
    if (this.ffmpegPath !== 'ffmpeg') {
      ffmpeg.setFfmpegPath(this.ffmpegPath);
    }
    if (this.ffprobePath !== 'ffprobe') {
      ffmpeg.setFfprobePath(this.ffprobePath);
    }
  }

  /**
   * 标准化Windows路径，避免MAX_PATH限制问题
   */
  private normalizeWindowsPath(filePath: string): string {
    if (process.platform === 'win32') {
      // Windows绝对路径添加\\?\前缀
      if (/^[a-zA-Z]:\\/.test(filePath) && !filePath.startsWith('\\\\?\\')) {
        return '\\\\?\\' + filePath;
      }
    }
    return filePath;
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
   * 检查视频是否包含音频流
   */
  public hasAudioStream(videoPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const normalizedPath = this.normalizeWindowsPath(path.resolve(videoPath));
      const args = [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        normalizedPath,
      ];

      this.emit('log', {
        message: `[FFprobe命令] 检查视频是否包含音频流 ${this.ffprobePath}`,
        type: 'debug',
      });

      const result = spawnSync(this.ffprobePath, args, {
        encoding: 'utf8',
        windowsHide: true,
      });

      if (result.error || result.status !== 0) {
        resolve(false);
        return;
      }

      const hasAudio = (result.stdout || '').trim().includes('audio');
      resolve(hasAudio);
    });
  }

  /**
   * 检测指定时间范围内是否有场景变化
   */
  public detectSceneChange(
    videoPath: string,
    startTime: number,
    checkDuration: number,
    threshold: number
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const normalizedPath = this.normalizeWindowsPath(path.resolve(videoPath));

      // 构建滤镜：选择在指定时间范围内且场景变化超过阈值的帧
      const videoFilter = `select='between(t,${startTime},${
        startTime + checkDuration
      })*gt(scene,${threshold})',showinfo`;

      const args = [
        '-hide_banner',
        '-i',
        normalizedPath,
        '-vf',
        videoFilter,
        '-an', // 禁用音频处理
        '-f',
        'null',
        '-', // 输出到空
      ];

      this.emit('log', {
        message: `[FFmpeg命令] 检测指定时间范围内是否有场景变化 ${this.ffmpegPath}`,
        type: 'debug',
      });

      const ffmpegProcess = spawn(this.ffmpegPath, args, { windowsHide: true });

      let stderrOutput = '';
      ffmpegProcess.stderr.on('data', chunk => {
        stderrOutput += chunk.toString();
      });

      ffmpegProcess.on('error', error => {
        console.error(`[FFmpeg错误] 场景检测进程错误: ${error.message}`);
        reject(new Error(`场景检测进程错误: ${error.message}`));
      });

      ffmpegProcess.on('close', code => {
        // 在stderr输出中查找场景变化信息
        // showinfo滤镜会输出匹配的帧信息，包含"pts_time:"字段
        const sceneChangeDetected = /pts_time:([0-9.]+)/.test(stderrOutput);
        console.log(
          `[场景检测] 结果: ${
            sceneChangeDetected ? '检测到场景变化' : '未检测到场景变化'
          }`
        );
        resolve(sceneChangeDetected);
      });
    });
  }

  /**
   * 提取视频片段
   */
  public extractSegment(
    videoPath: string,
    startTime: number,
    duration: number,
    outputPath: string,
    hasAudio: boolean,
    reencode: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 确保输出目录存在
      const outputDir = path.dirname(outputPath);
      try {
        fs.mkdirSync(outputDir, { recursive: true });
      } catch (error) {
        // 目录已存在或其他错误，继续执行
      }

      const normalizedInput = this.normalizeWindowsPath(
        path.resolve(videoPath)
      );
      const normalizedOutput = this.normalizeWindowsPath(
        path.resolve(outputPath)
      );

      // 基本参数：输入定位和时长
      const args: string[] = [
        '-y', // 覆盖输出文件
        '-hide_banner',
        '-ss',
        startTime.toString(), // 输入定位（放在-i前以提高精度）
        '-i',
        normalizedInput,
        '-t',
        duration.toString(), // 片段时长
        '-avoid_negative_ts',
        'make_zero',
        '-fflags',
        '+genpts',
      ];

      if (reencode) {
        // 重新编码确保时长准确
        args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');

        if (hasAudio) {
          // 视频有音频时编码音频
          args.push('-c:a', 'aac', '-b:a', '128k');
        } else {
          // 视频无音频时禁用音频
          args.push('-an');
        }
      } else {
        // 流复制（快速但不保证时长准确）
        args.push('-c', 'copy');
      }

      args.push(normalizedOutput);

      this.emit('log', {
        message: `[FFmpeg命令] 提取视频片段 ${this.ffmpegPath}`,
        type: 'debug',
      });

      const ffmpegProcess = spawn(this.ffmpegPath, args, { windowsHide: true });

      let stderrOutput = '';
      ffmpegProcess.stderr.on('data', chunk => {
        stderrOutput += chunk.toString();
      });

      ffmpegProcess.on('error', error => {
        console.error(`[FFmpeg错误] 片段提取进程错误: ${error.message}`);
        reject(new Error(`片段提取进程错误: ${error.message}`));
      });

      ffmpegProcess.on('close', code => {
        if (code === 0) {
          this.emit('log', {
            message: `[片段提取] 成功提取片段: ${outputPath}`,
            type: 'debug',
          });
          resolve();
        } else {
          const errorMessage = [
            `FFmpeg处理失败，退出码: ${code}`,
            `输入文件: ${videoPath}`,
            `开始时间: ${startTime}`,
            `持续时间: ${duration}`,
            `输出文件: ${outputPath}`,
            'FFmpeg错误输出:',
            stderrOutput,
          ].join('\n');
          console.error(`[FFmpeg错误] ${errorMessage}`);
          reject(new Error(errorMessage));
        }
      });
    });
  }

  /**
   * 验证生成片段的时长
   */
  public verifySegmentDuration(segmentPath: string): Promise<number> {
    return this.getVideoDuration(segmentPath).catch(error => {
      return 0;
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
          `-vf setpts=${1 / speed}*PTS`,
          `-af atempo=${speed > 2 ? 2 : speed}`,
          ...(speed > 2 ? ['-af', `atempo=${speed / 2}`] : []),
          '-t 20',
          '-c:v libx264', // 视频编码器
          '-preset fast', // 编码速度
          '-crf 23', // 质量参数
          '-c:a aac', // 音频编码器
          '-b:a 128k', // 音频比特率
          '-vf scale=720:1280', // 统一分辨率
          '-r 30', // 统一帧率
          '-movflags +faststart', // 优化网络播放
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
          '-c:v libx264', // 视频编码器
          '-preset fast', // 编码速度
          '-crf 23', // 质量参数
          '-c:a aac', // 音频编码器
          '-b:a 128k', // 音频比特率
          '-vf scale=720:1280', // 统一分辨率
          '-r 30', // 统一帧率
          '-movflags +faststart', // 优化网络播放
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

      // 创建 concat 列表文件
      const listPath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
      const listContent = videoFiles
        .map(file => `file '${path.resolve(file)}'`)
        .join('\n');

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
        // .outputOptions([
        //   '-c:v libx264', // 视频编码器
        //   '-preset fast', // 编码速度
        //   '-crf 23', // 质量参数
        //   '-c:a aac', // 音频编码器
        //   '-b:a 128k', // 音频比特率
        //   '-vf scale=720:1280', // 统一分辨率
        //   '-r 30', // 统一帧率
        //   '-movflags +faststart', // 优化网络播放
        // ])
        .output(outputPath);

      this.runCommand(command, operationName)
        .then(() => {
          // 清理临时文件
          try {
            if (fs.existsSync(listPath)) {
              fs.unlinkSync(listPath);
            }
          } catch (e) {
            console.warn('清理临时文件失败:', e);
          }
          resolve();
        })
        .catch(error => {
          // 清理临时文件
          try {
            if (fs.existsSync(listPath)) {
              fs.unlinkSync(listPath);
            }
          } catch (e) {
            console.warn('清理临时文件失败:', e);
          }
          reject(error);
        });
    });
  }

  /**
   * 拆解视频文件 - 将长视频拆分为多个短视频
   * @param inputPath 输入视频路径
   * @param outputDir 输出目录
   * @param segmentDuration 每个片段的时长（秒），默认为20秒
   * @param operationName 操作名称
   * @returns Promise<string[]> 返回拆分后的视频文件路径数组
   */
  public splitVideo(
    inputPath: string,
    outputDir: string,
    segmentDuration: number = 20,
    operationName = '视频拆解'
  ): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // 1. 获取视频总时长
        const totalDuration = await this.getVideoDuration(inputPath);

        // 2. 计算需要拆分成多少段
        const segmentCount = Math.ceil(totalDuration / segmentDuration);

        // 3. 创建输出目录
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // 4. 准备输出文件路径数组
        const outputFiles: string[] = [];

        // 5. 创建临时目录
        const tempDir = path.join(outputDir, 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        // 6. 循环处理每一段
        for (let i = 0; i < segmentCount; i++) {
          const startTime = i * segmentDuration;
          // 最后一段使用剩余时长
          const duration =
            i === segmentCount - 1
              ? totalDuration - startTime
              : segmentDuration;

          // 生成输出文件名，使用3位数字序号
          const fileName = `part_${String(i + 1).padStart(3, '0')}.mp4`;
          const outputPath = path.join(outputDir, fileName);
          outputFiles.push(outputPath);

          // 截取当前段
          await this.trimSegment(
            inputPath,
            outputPath,
            startTime,
            duration,
            `${operationName} - 段 ${i + 1}/${segmentCount}`
          );

          // 更新进度
          const progress = ((i + 1) / segmentCount) * 100;
          this.emit('progress', {
            progress,
            operation: operationName,
          });
        }

        // 7. 清理临时目录
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (e) {
          console.warn('清理临时目录失败:', e);
        }

        resolve(outputFiles);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 根据片段信息拆解视频文件 - 将长视频按照指定的片段信息拆分为多个短视频
   * @param inputPath 输入视频路径
   * @param segments 片段信息数组，包含每个片段的时长和输出路径
   * @param operationName 操作名称
   * @returns Promise<string[]> 返回拆分后的视频文件路径数组
   */
  public splitVideoBySegments(
    inputPath: string,
    segments: VideoSegment[],
    operationName = '按片段拆解视频'
  ): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // 1. 验证输入视频是否存在
        if (!fs.existsSync(inputPath)) {
          reject(new Error(`输入视频文件不存在: ${inputPath}`));
          return;
        }

        // 2. 获取视频总时长
        const totalDuration = await this.getVideoDuration(inputPath);

        // 3. 验证片段信息
        if (!segments || segments.length === 0) {
          reject(new Error('片段信息数组不能为空'));
          return;
        }

        // 4. 计算所有片段的总时长
        const segmentsTotalDuration = segments.reduce(
          (sum, segment) => sum + segment.fragmentDuration,
          0
        );

        // 5. 验证片段总时长是否超过视频总时长
        if (segmentsTotalDuration > totalDuration) {
          console.warn(
            `片段总时长(${segmentsTotalDuration}秒)超过视频总时长(${totalDuration}秒)，将只处理视频时长范围内的部分`
          );
        }

        // 6. 准备输出文件路径数组
        const outputFiles: string[] = [];

        // 7. 循环处理每个片段
        let currentStartTime = 0;
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];

          // 如果当前开始时间已经超过视频总时长，则停止处理
          if (currentStartTime >= totalDuration) {
            console.warn(`已达到视频总时长，停止处理剩余片段`);
            break;
          }

          // 计算当前片段的实际时长（不超过剩余视频时长）
          const remainingDuration = totalDuration - currentStartTime;
          const actualDuration = Math.min(
            segment.fragmentDuration,
            remainingDuration
          );

          // 确保输出目录存在
          const outputDir = path.dirname(segment.filePath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          // 截取当前片段
          await this.trimSegment(
            inputPath,
            segment.filePath,
            currentStartTime,
            actualDuration,
            `${operationName} - 片段 ${i + 1}/${segments.length}`
          );

          // 添加到输出文件列表
          outputFiles.push(segment.filePath);

          // 更新开始时间
          currentStartTime += actualDuration;

          // 更新进度
          const progress = ((i + 1) / segments.length) * 100;
          this.emit('progress', {
            progress,
            operation: operationName,
          });
        }

        resolve(outputFiles);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 截取视频片段
   * @param inputPath 输入视频路径
   * @param outputPath 输出视频路径
   * @param startTime 开始时间（秒）
   * @param duration 时长（秒）
   * @param operationName 操作名称
   */
  private trimSegment(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
    operationName: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          `-ss ${startTime}`,
          `-t ${duration}`,
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
        ])
        .output(outputPath);

      this.runCommand(command, operationName)
        .then(() => resolve())
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
  private runCommand(
    command: ffmpeg.FfmpegCommand,
    operationName: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      command
        .on('start', commandLine => {
          this.emit('log', {
            message: `执行FFmpeg命令: ${commandLine}`,
            type: 'debug',
          });
        })
        .on('progress', progress => {
          // 计算进度百分比
          const percent = progress.percent || 0;
          this.emit('progress', {
            progress: percent,
            operation: operationName,
          });
        })
        .on('end', () => {
          this.emit('log', {
            message: `[FFmpeg完成] ${operationName} 操作成功完成`,
            type: 'debug',
          });
          resolve();
        })
        .on('error', err => {
          console.error(`[FFmpeg错误] ${operationName} 失败: ${err.message}`);
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
          '-b:a 192k', // 设置音频比特率
        ])
        .output(outputPath);

      this.runCommand(command, operationName)
        .then(() => resolve())
        .catch(reject);
    });
  }
}

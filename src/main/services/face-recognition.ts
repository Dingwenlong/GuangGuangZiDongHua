import { InferenceSession, Tensor } from 'onnxruntime-node';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { EventEmitter } from 'events';
import { spawn, spawnSync } from 'child_process';
import { FFmpegUtil } from '../lib/ffmpeg';

// 配置参数接口
export interface FaceRecognitionConfig {
  MODEL_WIDTH: number;
  MODEL_HEIGHT: number;
  CONFIDENCE_THRESHOLD: number;
  IOU_THRESHOLD: number;
  MAX_DETECTIONS: number;
}

// 场景片段接口
export interface SceneSegment {
  start: number;
  end: number;
}

class FaceRecognition extends EventEmitter {
  private session: InferenceSession | null = null;
  private config: FaceRecognitionConfig;
  private modelLoaded: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private modelPath!: string;
  private ffmpegUtil: FFmpegUtil;

  constructor(config?: Partial<FaceRecognitionConfig>) {
    super();

    // 默认配置
    this.config = {
      MODEL_WIDTH: 640,
      MODEL_HEIGHT: 640,
      CONFIDENCE_THRESHOLD: 0.5,
      IOU_THRESHOLD: 0.45,
      MAX_DETECTIONS: 1000,
      ...config,
    };

    // 初始化FFmpeg工具
    this.ffmpegUtil = FFmpegUtil.getInstance();

    // 设置模型路径
    this.setupModelPath();
  }

  /**
   * 设置模型路径
   */
  private setupModelPath(): void {
    const modelName = 'yolov5m-face.onnx';

    // 开发环境路径 - 项目根目录下的 resources 文件夹
    const devResourcesPath = path.join(process.cwd(), 'resources');
    const devModelPath = path.join(devResourcesPath, modelName);

    // 生产环境路径 - Electron 的 resources 目录
    const prodResourcesPath = process.resourcesPath || '';
    const prodModelPath = path.join(prodResourcesPath, modelName);

    // 优先使用开发环境路径，然后是生产环境路径
    if (fs.existsSync(devModelPath)) {
      this.modelPath = devModelPath;
      console.log(`[FaceRecognition] 使用开发环境模型路径: ${this.modelPath}`);
    } else if (fs.existsSync(prodModelPath)) {
      this.modelPath = prodModelPath;
      console.log(`[FaceRecognition] 使用生产环境模型路径: ${this.modelPath}`);
    } else {
      // 如果都找不到，尝试在当前目录查找
      const currentDirPath = path.join(process.cwd(), modelName);
      if (fs.existsSync(currentDirPath)) {
        this.modelPath = currentDirPath;
        console.log(
          `[FaceRecognition] 使用当前目录模型路径: ${this.modelPath}`
        );
      } else {
        // 最后尝试相对路径
        this.modelPath = path.join(__dirname, '../../resources', modelName);
        console.log(`[FaceRecognition] 使用相对模型路径: ${this.modelPath}`);
      }
    }
  }

  /**
   * 初始化模型
   */
  private async initialize(): Promise<void> {
    // 防止重复初始化
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        console.log(`[FaceRecognition] 加载模型: ${this.modelPath}`);
        this.session = await InferenceSession.create(this.modelPath);
        this.modelLoaded = true;
        console.log('[FaceRecognition] ONNX模型加载成功.');
      } catch (error) {
        console.error('[FaceRecognition] 加载ONNX模型失败:', error);
        this.initializationPromise = null;
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * 检测视频中的人脸，返回处理后的视频路径
   * @param videoPath 输入视频路径
   * @returns 处理后的视频路径
   */
  public async processVideo(videoPath: string): Promise<string> {
    // 参数验证
    console.log(`[FaceRecognition] 输入视频路径: ${videoPath}`);

    if (!videoPath || typeof videoPath !== 'string') {
      throw new Error('无效的视频路径: videoPath必须是一个非空字符串');
    }

    // 确保模型已初始化
    if (!this.modelLoaded) {
      await this.initialize();
    }

    // 创建临时目录
    const tempDir = path.join(
      fs.mkdtempSync(path.join(require('os').tmpdir(), 'video-process-'))
    );
    console.log(`[FaceRecognition] 创建临时目录: ${tempDir}`);

    try {
      // this.emit('status', '步骤 1/3: 检测场景（分镜）...');
      this.emit('log', {
        message: '检测场景（分镜）...',
        type: 'info',
      });
      const scenes = await this.detectScenes(videoPath);
      this.emit('status', `检测到 ${scenes.length} 个场景`);

      // this.emit('status', '步骤 2/3: 对每个场景进行人脸检测...');
      this.emit('log', {
        message: '对每个场景进行人脸检测...',
        type: 'info',
      });

      const scenesToKeep: SceneSegment[] = [];

      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        this.emit(
          'status',
          `分析场景 ${i + 1}/${scenes.length} (${s.start.toFixed(
            2
          )} - ${s.end.toFixed(2)})`
        );

        // --- 修改开始：检测开头、中间、结尾 ---
        const duration = s.end - s.start;
        let hasFace = false;

        // 计算三个检测点，并做边界保护
        // 使用 Set 去重，防止超短视频片段导致时间点重复
        const checkPointsRaw = [
          s.start + Math.min(0.2, duration / 2), // 开头 (偏移0.2秒，防止正好切在转场上)
          s.start + duration / 2, // 中间
          s.end - Math.min(0.2, duration / 2), // 结尾
        ];

        // 排序并去重
        const checkPoints = Array.from(new Set(checkPointsRaw)).sort(
          (a, b) => a - b
        );

        for (let j = 0; j < checkPoints.length; j++) {
          const checkTime = checkPoints[j];
          // 传入唯一的 index (i * 100 + j) 防止临时文件名冲突
          const isFaceDetected = await this.checkFrameForFace(
            videoPath,
            checkTime,
            tempDir,
            i * 100 + j
          );

          if (isFaceDetected) {
            hasFace = true;
            // 只要发现一处有人脸，立即判定为包含人脸，停止后续检测
            break;
          }
        }
        // --- 修改结束 ---

        if (!hasFace) scenesToKeep.push(s);

        console.log(
          `场景 ${i + 1} (${s.start.toFixed(2)} - ${s.end.toFixed(2)}) ${
            hasFace ? '有人脸, 删除' : '无人脸, 保留'
          }`
        );
      }

      // this.emit('status', `分析完毕，保留 ${scenesToKeep.length} 个场景`);
      console.log(`分析完毕，保留 ${scenesToKeep.length} 个场景`);

      if (scenesToKeep.length === 0) {
        // 没有保留的场景，直接返回原视频路径 (或者根据需求抛错)
        console.log('所有场景均检测到人脸，直接返回原视频。');
        await this.safeRemoveDirWithRetries(tempDir);
        return videoPath;
      }

      // this.emit('status', '步骤 3/3: 切片并合并生成输出视频...');
      this.emit('log', {
        message: '切片并合并生成输出视频...',
        type: 'info',
      });

      // 生成输出路径，只需要去掉@符号
      const fileName = path.basename(videoPath);
      const outputFileName = fileName.startsWith('@')
        ? fileName.substring(1)
        : fileName;
      const outputPath = path.join(path.dirname(videoPath), outputFileName);

      await this.mergeScenes(videoPath, scenesToKeep, outputPath, tempDir);
      console.log(`处理完成！输出路径: ${outputPath}`);
      // this.emit('status', '处理完成！');
      // this.emit('processing-done', outputPath);

      return outputPath;
    } catch (error: any) {
      console.error('[FaceRecognition] 处理视频失败:', error);
      this.emit('log', {
        message: '处理视频失败:' + error.message,
        type: 'error',
      });
      throw error;
    } finally {
      await this.safeRemoveDirWithRetries(tempDir);
    }
  }

  /**
   * 检测视频中的场景变化
   * @param videoPath 视频路径
   * @returns 场景片段数组
   */
  private async detectScenes(videoPath: string): Promise<SceneSegment[]> {
    // 使用FFmpegUtil的detectScenes方法
    return this.ffmpegUtil.detectScenes(videoPath);
  }

  /**
   * 检查指定时间点的帧是否有人脸
   * @param videoPath 视频路径
   * @param timeInSeconds 时间点（秒）
   * @param tempDir 临时目录
   * @param index 索引 (用于生成临时文件名)
   * @returns 是否有人脸
   */
  private async checkFrameForFace(
    videoPath: string,
    timeInSeconds: number,
    tempDir: string,
    index: number
  ): Promise<boolean> {
    const framePath = path.join(tempDir, `frame_${index}.jpg`);
    try {
      // 提取帧
      const extractCommand = `ffmpeg -ss ${timeInSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}" -y`;
      const { error } = spawnSync(extractCommand, { shell: true });
      if (error) {
        console.error(`[FaceRecognition] 提取帧失败: ${error.message}`);
        return false;
      }

      if (!fs.existsSync(framePath)) return false;

      // 读入内存并立即删除以避免文件句柄占用
      const fileData = fs.readFileSync(framePath);
      try {
        fs.unlinkSync(framePath);
      } catch {
        /* 忽略删除错误 */
      }

      // 图像预处理
      const modelInputSize = this.config.MODEL_WIDTH;
      const imageRawBuffer = await sharp(fileData)
        .resize(modelInputSize, modelInputSize)
        .raw()
        .toBuffer();

      // 转换为模型输入格式
      const pixels = imageRawBuffer;
      const channelSize = modelInputSize * modelInputSize;
      const red = new Float32Array(channelSize);
      const green = new Float32Array(channelSize);
      const blue = new Float32Array(channelSize);

      for (let i = 0; i < channelSize; i++) {
        red[i] = pixels[i * 3] / 255.0;
        green[i] = pixels[i * 3 + 1] / 255.0;
        blue[i] = pixels[i * 3 + 2] / 255.0;
      }

      const inputTensor = new Tensor(
        'float32',
        Float32Array.from([...red, ...green, ...blue]),
        [1, 3, modelInputSize, modelInputSize]
      );

      // 模型推理
      const inputName = this.session!.inputNames[0];
      const feeds: Record<string, Tensor> = { [inputName]: inputTensor };
      const results = await this.session!.run(feeds);

      // 处理推理结果
      const outputName = this.session!.outputNames[0];
      const outputTensor = results[outputName];
      const detections = outputTensor.data as Float32Array;

      const numDetections = outputTensor.dims[1];
      const numColumns = outputTensor.dims[2];

      // 检查是否有人脸
      for (let i = 0; i < numDetections; i++) {
        const confidence = detections[i * numColumns + 4];
        if (confidence > this.config.CONFIDENCE_THRESHOLD) {
          return true; // 检测到人脸
        }
      }

      return false; // 未检测到人脸
    } catch (err) {
      console.error('[FaceRecognition] 检测人脸失败:', err);
      if (fs.existsSync(framePath)) {
        try {
          fs.unlinkSync(framePath);
        } catch {
          /* ignore */
        }
      }
      return false;
    }
  }

  /**
   * 合并场景片段生成输出视频
   * @param videoPath 输入视频路径
   * @param scenesToKeep 要保留的场景片段
   * @param outputPath 输出视频路径
   * @param tempDir 临时目录
   */
  private async mergeScenes(
    videoPath: string,
    scenesToKeep: SceneSegment[],
    outputPath: string,
    tempDir: string
  ): Promise<void> {
    const listFile = path.join(tempDir, 'concat_list.txt');
    let listContent = '';

    for (let i = 0; i < scenesToKeep.length; i++) {
      const scene = scenesToKeep[i];
      const clipPath = path.join(tempDir, `clip_${i}.mp4`);

      // 计算片段时长
      const duration = Math.max(0.01, scene.end - scene.start);

      // 生成片段
      const cutCmd = [
        'ffmpeg',
        `-ss ${scene.start}`,
        `-t ${duration}`,
        `-i "${videoPath}"`,
        '-c:v libx264',
        '-preset veryfast',
        '-crf 23',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 128k',
        '-ac 2',
        '-ar 48000',
        '-fflags +genpts',
        '-avoid_negative_ts make_zero',
        `-movflags +faststart`,
        `-y "${clipPath}"`,
      ].join(' ');

      this.emit('status', `生成片段 ${i + 1}/${scenesToKeep.length}`);
      const { error } = spawnSync(cutCmd, { shell: true });
      if (error) {
        throw new Error(`生成片段失败: ${error.message}`);
      }

      // 增加到concat列表
      const safePath = clipPath.replace(/\\/g, '/');
      listContent += `file '${safePath}'\n`;
    }

    fs.writeFileSync(listFile, listContent, 'utf8');

    // 合并片段
    const mergeCmd = `ffmpeg -f concat -safe 0 -i "${listFile}" -c copy -movflags +faststart -y "${outputPath}"`;
    const { error: mergeError } = spawnSync(mergeCmd, { shell: true });

    if (mergeError) {
      // 如果concat copy失败，退回到filter_complex concat
      console.warn(
        '[FaceRecognition] concat copy失败，使用re-encode merge:',
        mergeError.message
      );

      const inputs = scenesToKeep
        .map((_, idx) => `-i "${path.join(tempDir, `clip_${idx}.mp4`)}"`)
        .join(' ');
      const count = scenesToKeep.length;
      const filter = `-filter_complex "${Array.from(
        { length: count },
        (_, i) => `[${i}:v:0] [${i}:a:0]`
      ).join(' ')} concat=n=${count}:v=1:a=1 [v] [a]" -map "[v]" -map "[a]"`;
      const fallbackCmd = `ffmpeg ${inputs} ${filter} -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outputPath}"`;
      const { error: fallbackError } = spawnSync(fallbackCmd, { shell: true });

      if (fallbackError) {
        throw new Error(`合并片段失败: ${fallbackError.message}`);
      }
    }
  }

  /**
   * 安全删除临时目录，带重试机制
   * @param dirPath 目录路径
   * @param retries 重试次数
   * @param delayMs 延迟时间（毫秒）
   */
  private async safeRemoveDirWithRetries(
    dirPath: string,
    retries = 6,
    delayMs = 300
  ): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
        return;
      } catch (e) {
        if (attempt === retries - 1) {
          console.error('[FaceRecognition] 无法删除临时目录:', e);
          return;
        }
        // 等待后重试
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }
}

export default FaceRecognition;

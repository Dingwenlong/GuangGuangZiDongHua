import { InferenceSession, Tensor } from 'onnxruntime-node';
import path from 'path';
import sharp from 'sharp';
import fs from 'fs';

// 配置参数接口
export interface DetectionConfig {
  MODEL_WIDTH: number;
  MODEL_HEIGHT: number;
  CONFIDENCE_THRESHOLD: number;
  IOU_THRESHOLD: number;
  MAX_DETECTIONS: number;
  LINE_THICKNESS: number;
  VID_STRIDE: number;
}

// 检测结果接口
export interface DetectionResult {
  label: string;
  confidence: number;
  normalizedCoords: {
    cx: number;
    cy: number;
    width: number;
    height: number;
  };
}

// 边界框接口（用于NMS）
interface BoundingBox {
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  score: number;
  original: string;
}

/**
 * 独立的滑块验证码缺口检测器
 * 可以在任何类的方法中调用
 */
export class SliderGapDetector {
  private session: InferenceSession | null = null;
  private config: DetectionConfig;
  private modelLoaded: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private modelPath!: string;

  constructor(config?: Partial<DetectionConfig>) {
    // 默认配置
    this.config = {
      MODEL_WIDTH: 320,
      MODEL_HEIGHT: 320,
      CONFIDENCE_THRESHOLD: 0.7,
      IOU_THRESHOLD: 0.45,
      MAX_DETECTIONS: 1000,
      LINE_THICKNESS: 3,
      VID_STRIDE: 1,
      ...config,
    };
    // 设置模型路径
    this.setupModelPath();
  }

  /**
   * 设置模型路径
   */
  private setupModelPath(): void {
    const modelName = 'best.onnx';

    // 开发环境路径 - 项目根目录下的 resources 文件夹
    const devResourcesPath = path.join(process.cwd(), 'resources');
    const devModelPath = path.join(devResourcesPath, modelName);

    // 生产环境路径 - Electron 的 resources 目录
    const prodResourcesPath = process.resourcesPath || '';
    // 尝试直接在resources目录下查找（与app同级）
    const parentResourcesPath = prodResourcesPath.includes('app')
      ? path.join(path.dirname(prodResourcesPath), 'resources')
      : prodResourcesPath;
    const prodModelPath = path.join(parentResourcesPath, modelName);

    // 优先使用开发环境路径，然后是生产环境路径
    if (fs.existsSync(devModelPath)) {
      this.modelPath = devModelPath;
      console.log(
        `[SliderGapDetector] Using development model path: ${this.modelPath}`
      );
    } else if (fs.existsSync(prodModelPath)) {
      this.modelPath = prodModelPath;
      console.log(
        `[SliderGapDetector] Using production model path: ${this.modelPath}`
      );
    } else {
      // 如果都找不到，尝试在当前目录查找
      const currentDirPath = path.join(process.cwd(), modelName);
      if (fs.existsSync(currentDirPath)) {
        this.modelPath = currentDirPath;
        console.log(
          `[SliderGapDetector] Using current directory model path: ${this.modelPath}`
        );
      } else {
        // 最后尝试相对路径
        this.modelPath = path.join(__dirname, '../../resources', modelName);
        console.log(
          `[SliderGapDetector] Using relative model path: ${this.modelPath}`
        );
      }
    }

    console.log(`[SliderGapDetector] Final model path: ${this.modelPath}`);
  }

  /**
   * 主要调用接口：从URL检测滑块验证码并返回滑动距离
   */
  async detectFromUrl(
    imageUrl: string,
    sliderStartX: number,
    sliderStartY: number,
    bgImageWidth: number,
    bgImageHeight: number,
    sliderWidth: number = 40,
    adjustmentFactor: number = 0.08
  ): Promise<number> {
    // console.log('[SliderGapDetector] Starting detection from URL...');

    try {
      // 1. 获取图片并转换为base64
      const imageBase64 = await this.fetchImageAsBase64(imageUrl);

      // 2. 调用检测方法
      return await this.detectAndCalculateDistance(
        imageBase64,
        sliderStartX,
        sliderStartY,
        bgImageWidth,
        bgImageHeight,
        sliderWidth,
        adjustmentFactor
      );
    } catch (error) {
      console.error(
        '[SliderGapDetector] Failed to process image from URL:',
        error
      );
      throw error;
    }
  }

  /**
   * 主要调用接口：检测滑块验证码并返回滑动距离
   */
  async detectAndCalculateDistance(
    imageBase64: string,
    sliderStartX: number,
    sliderStartY: number,
    bgImageWidth: number,
    bgImageHeight: number,
    sliderWidth: number = 40,
    adjustmentFactor: number = 0.08
  ): Promise<number> {
    // console.log('[SliderGapDetector] Starting detection and calculation...');

    try {
      // 1. 确保模型已初始化
      if (!this.modelLoaded) {
        await this.initialize();
      }

      // 2. 检测缺口
      const detectionResults = await this.detectGaps(imageBase64);

      if (detectionResults.length === 0) {
        console.log('[SliderGapDetector] 未检测到缺口，返回0距离.');
        return 0;
      }
      console.log('检测结果:', detectionResults);
      const sliderCenterY = sliderStartY + sliderWidth / 2;
      console.log(
        `滑动距离参数：sliderStartX=${sliderStartX}, sliderStartY=${sliderCenterY}, bgImageWidth=${bgImageWidth}, bgImageHeight=${bgImageHeight}, sliderWidth=${sliderWidth}, adjustmentFactor=${adjustmentFactor}`
      );

      // 3. 计算滑动距离
      const distance = this.calculateSlideDistance(
        sliderStartX,
        sliderCenterY,
        bgImageWidth,
        bgImageHeight,
        detectionResults,
        sliderWidth,
        adjustmentFactor
      );
      console.log('滑动计算距离:', distance);

      console.log(
        `[SliderGapDetector] Final result: ${distance.toFixed(2)} pixels`
      );
      return distance;
    } catch (error) {
      console.error(
        '[SliderGapDetector] Detection and calculation failed:',
        error
      );
      throw error;
    }
  }

  /**
   * 从URL获取图片并转换为base64
   */
  private async fetchImageAsBase64(imageUrl: string): Promise<string> {
    // console.log(`[SliderGapDetector] Fetching image from URL: ${imageUrl}`);

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const imageBase64 = buffer.toString('base64');

    // console.log('[SliderGapDetector] Image fetched and converted to base64');
    return imageBase64;
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
        console.log(
          `[SliderGapDetector] Loading model from: ${this.modelPath}`
        );
        this.session = await InferenceSession.create(this.modelPath);
        this.modelLoaded = true;
        console.log('[SliderGapDetector] ONNX model loaded successfully.');
        console.log(
          '[SliderGapDetector] Model input names:',
          this.session.inputNames
        );
        console.log(
          '[SliderGapDetector] Model output names:',
          this.session.outputNames
        );
      } catch (error) {
        console.error('[SliderGapDetector] Failed to load ONNX model:', error);
        this.initializationPromise = null;
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * 检测图像中的缺口位置（内部方法）
   */
  private async detectGaps(imageBase64: string): Promise<DetectionResult[]> {
    if (!this.modelLoaded || !this.session) {
      throw new Error('Model not initialized.');
    }

    // console.log('[SliderGapDetector] Detecting gaps in image...');

    try {
      // 1. 图像预处理
      const { inputTensor, origW, origH, scale, padLeft, padTop } =
        await this.preprocessImage(imageBase64);

      // 2. 模型推理
      const outputData = await this.runInference(inputTensor);
      console.log('模型输出:', outputData);

      // 3. 后处理
      const results = this.postProcessResults(
        outputData,
        origW,
        origH,
        scale,
        padLeft,
        padTop
      );
      console.log('后处理结果:', results);

      console.log(
        `[SliderGapDetector] 检测已完成. 发现 ${results.length} 个缺口.`
      );
      return results;
    } catch (error) {
      console.error('[SliderGapDetector] Detection failed:', error);
      throw error;
    }
  }

  /**
   * 图像预处理 (Letterbox)
   */
  private async preprocessImage(imageBase64: string) {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const metadata = await sharp(imageBuffer).metadata();
    const origW = metadata.width!;
    const origH = metadata.height!;

    // console.log(`[SliderGapDetector] Original image size: ${origW}x${origH}`);

    // 计算 letterbox 参数
    const scale = Math.min(
      this.config.MODEL_WIDTH / origW,
      this.config.MODEL_HEIGHT / origH
    );
    const resizeW = Math.round(origW * scale);
    const resizeH = Math.round(origH * scale);
    const padW = this.config.MODEL_WIDTH - resizeW;
    const padH = this.config.MODEL_HEIGHT - resizeH;
    const padLeft = Math.floor(padW / 2);
    const padTop = Math.floor(padH / 2);

    // console.log(
    //   `[SliderGapDetector] Scale: ${scale.toFixed(
    //     4
    //   )}, Resize: ${resizeW}x${resizeH}, Padding: left=${padLeft}, top=${padTop}`
    // );

    // 使用 sharp 进行 letterbox 处理
    const rawPaddedData = await sharp(imageBuffer)
      .resize(resizeW, resizeH)
      .extend({
        top: padTop,
        left: padLeft,
        bottom: this.config.MODEL_HEIGHT - resizeH - padTop,
        right: this.config.MODEL_WIDTH - resizeW - padLeft,
        background: { r: 114, g: 114, b: 114 },
      })
      .removeAlpha()
      .raw()
      .toBuffer();

    // 转换为 Float32Array
    const float32Data = new Float32Array(
      1 * 3 * this.config.MODEL_HEIGHT * this.config.MODEL_WIDTH
    );
    for (
      let i = 0;
      i < this.config.MODEL_HEIGHT * this.config.MODEL_WIDTH;
      i++
    ) {
      float32Data[i] = rawPaddedData[i * 3] / 255.0;
      float32Data[i + this.config.MODEL_HEIGHT * this.config.MODEL_WIDTH] =
        rawPaddedData[i * 3 + 1] / 255.0;
      float32Data[i + 2 * this.config.MODEL_HEIGHT * this.config.MODEL_WIDTH] =
        rawPaddedData[i * 3 + 2] / 255.0;
    }

    const inputTensor = new Tensor('float32', float32Data, [
      1,
      3,
      this.config.MODEL_HEIGHT,
      this.config.MODEL_WIDTH,
    ]);

    return { inputTensor, origW, origH, scale, padLeft, padTop };
  }

  /**
   * 模型推理
   */
  private async runInference(inputTensor: Tensor): Promise<Float32Array> {
    console.log('[SliderGapDetector] Running model inference...');
    const startInference = Date.now();

    const feeds = { [this.session!.inputNames[0]]: inputTensor };
    const results = await this.session!.run(feeds);

    const inferenceTime = Date.now() - startInference;
    console.log(
      `[SliderGapDetector] Inference completed in ${inferenceTime}ms`
    );

    const outputTensor = results[this.session!.outputNames[0]];
    return outputTensor.data as Float32Array;
  }

  /**
   * 结果后处理
   */
  private postProcessResults(
    outputData: Float32Array,
    origW: number,
    origH: number,
    scale: number,
    padLeft: number,
    padTop: number
  ): DetectionResult[] {
    const candidateBoxes: BoundingBox[] = [];
    const numPredictions = Math.floor(outputData.length / 6);
    const numAttributes = 6;

    // console.log(
    //   `[SliderGapDetector] Processing ${numPredictions} predictions.`
    // );

    for (
      let i = 0;
      i < numPredictions && candidateBoxes.length < this.config.MAX_DETECTIONS;
      i++
    ) {
      const offset = i * numAttributes;
      if (offset + numAttributes > outputData.length) break;

      const confidence = outputData[offset + 4];
      if (confidence < this.config.CONFIDENCE_THRESHOLD) continue;

      const classScore = outputData[offset + 5];
      const score = confidence * classScore;
      if (score < this.config.CONFIDENCE_THRESHOLD) continue;

      // 从模型输出中获取坐标
      const model_cx = outputData[offset];
      const model_cy = outputData[offset + 1];
      const model_w = outputData[offset + 2];
      const model_h = outputData[offset + 3];

      // 坐标转换
      const resized_cx = Math.max(0, model_cx - padLeft);
      const resized_cy = Math.max(0, model_cy - padTop);
      const resized_w = Math.max(0, model_w);
      const resized_h = Math.max(0, model_h);

      const orig_cx = resized_cx / scale;
      const orig_cy = resized_cy / scale;
      const orig_w = resized_w / scale;
      const orig_h = resized_h / scale;

      // 确保坐标在有效范围内
      const clamped_cx = Math.max(0, Math.min(orig_cx, origW));
      const clamped_cy = Math.max(0, Math.min(orig_cy, origH));
      const clamped_w = Math.max(0, Math.min(orig_w, origW - clamped_cx));
      const clamped_h = Math.max(0, Math.min(orig_h, origH - clamped_cy));

      // 归一化到 0-1 范围
      const cx_norm = clamped_cx / origW;
      const cy_norm = clamped_cy / origH;
      const w_norm = clamped_w / origW;
      const h_norm = clamped_h / origH;

      // 生成 YOLO 格式标签字符串
      const label = `0 ${cx_norm.toFixed(6)} ${cy_norm.toFixed(
        6
      )} ${w_norm.toFixed(6)} ${h_norm.toFixed(6)}`;

      // 用于 NMS 的边界框
      const model_x1 = model_cx - model_w / 2;
      const model_y1 = model_cy - model_h / 2;
      const model_x2 = model_cx + model_w / 2;
      const model_y2 = model_cy + model_h / 2;

      candidateBoxes.push({
        box: [model_x1, model_y1, model_x2, model_y2],
        score: score,
        original: label,
      });
    }

    // console.log(
    //   `[SliderGapDetector] Found ${candidateBoxes.length} candidates before NMS.`
    // );

    // 应用非极大值抑制
    const finalLabels = this.nonMaxSuppression(candidateBoxes);

    // 转换为 DetectionResult 格式
    return finalLabels.map(label => {
      const [cls, cx, cy, w, h] = label.split(' ').map(Number);
      return {
        label,
        confidence: 1,
        normalizedCoords: { cx, cy, width: w, height: h },
      };
    });
  }

  /**
   * 计算两个边界框的交并比
   */
  private calculateIoU(
    box1: [number, number, number, number],
    box2: [number, number, number, number]
  ): number {
    const x1 = Math.max(box1[0], box2[0]);
    const y1 = Math.max(box1[1], box2[1]);
    const x2 = Math.min(box1[2], box2[2]);
    const y2 = Math.min(box1[3], box2[3]);
    const intersectionArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const box1Area = (box1[2] - box1[0]) * (box1[3] - box1[1]);
    const box2Area = (box2[2] - box2[0]) * (box2[3] - box2[1]);
    const unionArea = box1Area + box2Area - intersectionArea;
    return unionArea > 0 ? intersectionArea / unionArea : 0;
  }

  /**
   * 非极大值抑制
   */
  private nonMaxSuppression(boxes: BoundingBox[]): string[] {
    boxes.sort((a, b) => b.score - a.score);
    const results: string[] = [];

    while (boxes.length > 0 && results.length < this.config.MAX_DETECTIONS) {
      const bestBox = boxes.shift();
      if (bestBox) {
        results.push(bestBox.original);
        boxes = boxes.filter(
          box =>
            this.calculateIoU(bestBox.box, box.box) < this.config.IOU_THRESHOLD
        );
      }
    }

    return results;
  }

  /**
   * 计算滑动距离
   */
  private calculateSlideDistance(
    sliderStartX: number,
    sliderStartY: number,
    bgImageWidth: number,
    bgImageHeight: number,
    detectionResults: DetectionResult[],
    sliderWidth: number = 40,
    adjustmentFactor: number = 0.08
  ): number {
    // console.log('[SliderGapDetector] Calculating slide distance...');

    if (detectionResults.length === 0) {
      // console.log('[SliderGapDetector] Error: No detection results available.');
      return 0;
    }

    // 将检测结果转换为像素坐标
    const gaps = detectionResults.map(result => {
      const { cx, cy, width, height } = result.normalizedCoords;

      const pixelX = cx * bgImageWidth;
      const pixelY = cy * bgImageHeight;
      const pixelW = width * bgImageWidth;
      const pixelH = height * bgImageHeight;

      const gapLeftEdge = pixelX - pixelW / 2;
      return { pixelX, pixelY, pixelW, pixelH, gapLeftEdge };
    });

    // console.log(
    //   `[SliderGapDetector] Converted ${gaps.length} detections to pixel coordinates.`
    // );

    // 选择最佳缺口（Y坐标最接近滑块起始位置）
    let bestGap = gaps[0];
    let minDeltaY = Math.abs(gaps[0].pixelY - sliderStartY);

    for (let i = 1; i < gaps.length; i++) {
      const deltaY = Math.abs(gaps[i].pixelY - sliderStartY);
      if (deltaY < minDeltaY) {
        minDeltaY = deltaY;
        bestGap = gaps[i];
      }
    }

    // 计算滑动距离
    const distance =
      bestGap.gapLeftEdge - sliderStartX - sliderWidth * adjustmentFactor;
    const finalDistance = Math.max(0, distance);

    // console.log(
    //   `[SliderGapDetector] Final slide distance: ${finalDistance.toFixed(
    //     2
    //   )} pixels.`
    // );
    return finalDistance;
  }
  /**
   * 模拟人类滑动滑块（多层iframe版本）- 淘宝光合平台极速版
   * @param page 最外层的 Playwright Page 实例
   * @param sliderElement 已经定位到的滑块元素
   * @param distance 需要滑动的距离（像素）
   */
  // async simulateHumanSlideMultiIframe(
  //   page: any,
  //   sliderElement: any,
  //   distance: number
  // ): Promise<void> {
  //   console.log(`开始极速模拟人类滑动，距离: ${distance}px`);

  //   try {
  //     // 1. 检查滑块元素是否有效
  //     if (!sliderElement || typeof sliderElement.boundingBox !== 'function') {
  //       throw new Error('滑块元素无效');
  //     }

  //     // 2. 检查元素是否可见
  //     const isVisible = await sliderElement.isVisible();
  //     if (!isVisible) {
  //       throw new Error('滑块元素不可见');
  //     }

  //     console.log('滑块元素验证通过');

  //     // 3. 获取滑块的边界框信息
  //     const sliderBox = await sliderElement.boundingBox();
  //     if (!sliderBox) {
  //       throw new Error('无法获取滑块位置信息');
  //     }

  //     const startX = sliderBox.x + sliderBox.width / 2;
  //     const startY = sliderBox.y + sliderBox.height / 2;

  //     console.log(`滑块起始位置: (${startX}, ${startY})`);

  //     // 4. 生成极速滑动轨迹（无初始/加速延迟）
  //     const segments: Array<{ x: number; y: number; delay: number }> = [];
  //     let currentX = startX;
  //     let currentY = startY;

  //     // 第一阶段：直接启动（无迟疑，0-5%距离）
  //     currentX = startX + distance * 0.05;
  //     segments.push({
  //       x: currentX,
  //       y: startY + (Math.random() - 0.5) * 0.3,
  //       delay: 0,
  //     });

  //     // 第二阶段：极速加速滑动（5%-85%距离，无延迟）
  //     const accelerationDistance = distance * 0.8;
  //     const accelerationSteps = 6; // 极少步骤
  //     let accelCurrent = 0;
  //     for (let i = 1; i <= accelerationSteps; i++) {
  //       const progress = i / accelerationSteps;
  //       const ease = Math.pow(progress, 1.5); // 快速加速曲线
  //       const targetDistance = accelerationDistance * ease;
  //       const stepDistance = targetDistance - accelCurrent;
  //       accelCurrent = targetDistance;

  //       currentX += stepDistance;
  //       const jitterX = (Math.random() - 0.5) * 0.5;
  //       const jitterY = (Math.random() - 0.5) * 0.8;
  //       segments.push({
  //         x: currentX + jitterX,
  //         y: currentY + jitterY,
  //         delay: 0,
  //       }); // 无延迟
  //     }
  //     currentX = startX + distance * 0.85;

  //     // 第三阶段：减速调整（85%-95%距离，微延迟）
  //     const decelerationDistance = distance * 0.1;
  //     const decelerationSteps = 3;
  //     let decelCurrent = 0;
  //     for (let i = 1; i <= decelerationSteps; i++) {
  //       const progress = i / decelerationSteps;
  //       const ease = 1 - Math.pow(1 - progress, 1.2);
  //       const targetDistance = decelerationDistance * ease;
  //       const stepDistance = targetDistance - decelCurrent;
  //       decelCurrent = targetDistance;

  //       currentX += stepDistance;
  //       const jitterX = (Math.random() - 0.5) * 1.0;
  //       const jitterY = (Math.random() - 0.5) * 1.0;
  //       segments.push({
  //         x: currentX + jitterX,
  //         y: currentY + jitterY,
  //         delay: 3,
  //       }); // 极短延迟
  //     }
  //     currentX = startX + distance * 0.95;

  //     // 第四阶段：最终微调（95%-100%距离，短延迟）
  //     segments.push({
  //       x: startX + distance * 1.02,
  //       y: currentY + (Math.random() - 0.5) * 0.5,
  //       delay: 5,
  //     }); // 轻微过冲
  //     segments.push({ x: startX + distance, y: startY, delay: 10 }); // 精准定位

  //     // 5. 执行滑动操作（极速）
  //     console.log(`开始极速滑动，共 ${segments.length} 个步骤`);

  //     await sliderElement.hover();
  //     await page.mouse.down();

  //     const startTime = Date.now();
  //     for (const segment of segments) {
  //       await page.mouse.move(segment.x, segment.y, { steps: 1 }); // 最快移动
  //       if (segment.delay > 0) {
  //         await page.waitForTimeout(segment.delay);
  //       }
  //     }
  //     await page.mouse.up();

  //     const totalDuration = Date.now() - startTime;
  //     console.log(`极速滑动完成，总耗时：${totalDuration}ms`);

  //     // 滑动后无额外等待
  //     await page.waitForTimeout(20);
  //   } catch (error) {
  //     console.error('滑动过程中出错:', error);
  //     throw error;
  //   }
  // }

  /**
   * 模拟人类滑动滑块（多层iframe版本）- 淘宝光合平台优化版
   * @param page 最外层的 Playwright Page 实例
   * @param sliderElement 已经定位到的滑块元素
   * @param distance 需要滑动的距离（像素）
   */
  async simulateHumanSlideMultiIframe(
    page: any,
    sliderElement: any,
    distance: number
  ): Promise<void> {
    console.log(`开始模拟人类滑动，距离: ${distance}px`);

    try {
      // 1. 检查滑块元素是否有效
      if (!sliderElement || typeof sliderElement.boundingBox !== 'function') {
        throw new Error('滑块元素无效');
      }

      // 2. 检查元素是否可见
      const isVisible = await sliderElement.isVisible();
      if (!isVisible) {
        throw new Error('滑块元素不可见');
      }

      console.log('滑块元素验证通过');

      // 3. 获取滑块的边界框信息
      const sliderBox = await sliderElement.boundingBox();
      if (!sliderBox) {
        throw new Error('无法获取滑块位置信息');
      }

      const startX = sliderBox.x + sliderBox.width / 2;
      const startY = sliderBox.y + sliderBox.height / 2;

      console.log(`滑块起始位置: (${startX}, ${startY})`);

      // 4. 针对淘宝光合平台优化的滑动轨迹
      const segments: Array<{ x: number; y: number; delay: number }> = [];

      // 针对淘宝平台调整参数
      const totalSteps = 16 + Math.floor(Math.random() * 4); // 适中的步数
      const finalPosition = startX + distance;

      let currentX = startX;
      let currentY = startY;

      // 起始点
      segments.push({
        x: startX,
        y: startY,
        delay: 8 + Math.random() * 8, // 适中的起始延迟
      });

      // 使用更平滑的加速度曲线
      for (let i = 1; i <= totalSteps; i++) {
        const progress = i / totalSteps;

        // 平滑的加速度曲线 - 缓入缓出
        let easeX;
        if (progress < 0.3) {
          // 前30%缓入
          easeX = 1 - Math.pow(1 - progress / 0.3, 1.5);
        } else if (progress < 0.8) {
          // 中间50%匀速
          easeX = 0.3 + ((progress - 0.3) * 0.7) / 0.5;
        } else {
          // 后20%缓出
          easeX = 0.8 + (1 - Math.pow(1 - (progress - 0.8) / 0.2, 2)) * 0.2;
        }

        const targetX = startX + distance * easeX;

        // Y轴抖动 - 更自然的垂直移动
        const baseYVariation = Math.sin(progress * Math.PI * 5) * 1.0;
        const randomYJitter = (Math.random() - 0.5) * 1.2;
        const yOffset = baseYVariation + randomYJitter;

        // 速度控制 - 平滑过渡
        let stepDelay: number;
        if (progress < 0.3) {
          // 开始阶段：平稳启动
          stepDelay = 6 + Math.random() * 6;
        } else if (progress < 0.8) {
          // 中间阶段：稳定滑动
          stepDelay = 4 + Math.random() * 4;
        } else {
          // 结束阶段：平稳减速
          stepDelay = 8 + Math.random() * 8;
        }

        // 随机速度变化
        if (Math.random() > 0.85) {
          stepDelay *= 0.7 + Math.random() * 0.6;
        }

        segments.push({
          x: targetX,
          y: currentY + yOffset,
          delay: Math.max(3, stepDelay),
        });

        currentX = targetX;
      }

      // 更自然的结束动作 - 避免跳跃
      const shouldOvershoot = Math.random() > 0.25; // 75%概率过冲

      if (shouldOvershoot) {
        const overshootDistance = distance * (0.02 + Math.random() * 0.04); // 更小的过冲距离

        // 轻微过冲 - 分两步进行更平滑
        const overshootStep1 = overshootDistance * 0.6;
        segments.push({
          x: currentX + overshootStep1,
          y: currentY + (Math.random() - 0.5) * 0.8,
          delay: 10 + Math.random() * 8,
        });

        const overshootStep2 = overshootDistance * 0.4;
        segments.push({
          x: currentX + overshootStep1 + overshootStep2,
          y: currentY + (Math.random() - 0.5) * 0.6,
          delay: 8 + Math.random() * 6,
        });

        // 平滑回调 - 分两步进行
        const backStep1 = overshootDistance * 0.5;
        segments.push({
          x: currentX + overshootDistance - backStep1,
          y: currentY + (Math.random() - 0.5) * 0.4,
          delay: 8 + Math.random() * 6,
        });

        // 最终精确定位
        segments.push({
          x: finalPosition,
          y: currentY,
          delay: 12 + Math.random() * 10,
        });
      } else {
        // 无过冲时直接精确定位
        segments.push({
          x: finalPosition,
          y: currentY,
          delay: 15 + Math.random() * 10,
        });
      }

      // 最终微调 - 更平滑的小幅移动
      if (Math.random() > 0.4) {
        const microAdjust = (Math.random() - 0.5) * 1.5;
        segments.push({
          x: finalPosition + microAdjust,
          y: currentY + (Math.random() - 0.5) * 0.3,
          delay: 15 + Math.random() * 10,
        });

        // 回到精确位置
        segments.push({
          x: finalPosition,
          y: currentY,
          delay: 10 + Math.random() * 8,
        });
      }

      console.log(`轨迹: ${JSON.stringify(segments)}`);

      // 5. 执行滑动操作
      console.log(`开始自然滑动，共 ${segments.length} 个步骤`);

      await sliderElement.hover();
      // 添加随机反应时间
      await page.waitForTimeout(80 + Math.random() * 120);
      await page.mouse.down();

      const startTime = Date.now();

      // 执行滑动轨迹 - 确保每个移动都平滑
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        await page.mouse.move(segment.x, segment.y);
        if (segment.delay > 0) {
          await page.waitForTimeout(segment.delay);
        }
      }

      // 释放前短暂停顿
      await page.waitForTimeout(15 + Math.random() * 20);
      await page.mouse.up();

      const totalDuration = Date.now() - startTime;
      console.log(`自然滑动完成，总耗时：${totalDuration}ms`);

      // 释放后随机等待
      await page.waitForTimeout(150 + Math.random() * 200);
    } catch (error) {
      console.error('滑动过程中出错:', error);
      throw error;
    }
  }
}

// 默认导出
export default SliderGapDetector;

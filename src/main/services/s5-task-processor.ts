import * as path from 'path';
import * as fs from 'fs';
import WorkbenchManager from './workbench-manager';
import AudioExtractor from './audio-extractor';
import AudioProcessor from './audio-processing';

/**
 * S5任务处理器
 * 负责处理音频提取和音频处理任务
 */
class S5TaskProcessor {
  private workbenchManager: WorkbenchManager;
  private audioExtractor: AudioExtractor;
  private audioProcessor: AudioProcessor;
  private audioProcessCount: number = 0;
  private readonly latencyTime: number = 3 * 60 * 1000; // 3分钟等待时间
  private isRebooting: boolean = false; // 重启标志
  private readonly configPath: string =
    '\\\\192.168.31.99\\影视存储\\逛逛客户端\\ComfyUI\\config.json';
  private enableRebootCheck: boolean = true; // 是否启用重启检测
  private rebootThreshold: number = 5; // 重启阈值

  constructor(
    workbenchManager: WorkbenchManager,
    audioExtractor: AudioExtractor,
    audioProcessor: AudioProcessor
  ) {
    this.workbenchManager = workbenchManager;
    this.audioExtractor = audioExtractor;
    this.audioProcessor = audioProcessor;
    // 初始化时读取配置
    this.readConfig();
  }

  /**
   * 从指定路径读取配置文件
   * @private
   */
  private readConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const configContent = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configContent);

        // 从video_config中获取重启配置
        if (config.video_config && config.video_config.length > 0) {
          const videoConfig = config.video_config[0];
          if (videoConfig.reboot) {
            this.enableRebootCheck = videoConfig.reboot.require !== false; // 默认启用
            this.rebootThreshold = videoConfig.reboot.threshold || 5; // 默认阈值为5
            console.log(
              `已加载重启配置: enableRebootCheck=${this.enableRebootCheck}, threshold=${this.rebootThreshold}`
            );
          }
        }
      } else {
        console.warn(`配置文件不存在: ${this.configPath}`);
      }
    } catch (error) {
      console.error('读取配置文件失败:', error);
    }
  }

  /**
   * 执行S5任务
   * @returns Promise<void>
   */
  async execute(): Promise<void> {
    // 如果正在重启，跳过当前任务
    if (this.isRebooting) {
      console.log('服务正在重启中，等待3分钟后再继续处理任务');
      return;
    }
    // console.log('开始处理S5任务');

    const task = await this.workbenchManager.dequeueTask('s5TasksQueue');
    if (!task) return;
    console.log('执行任务s5');

    try {
      // 处理音频提取任务
      const videoPath = task as string;
      // 提取音频
      const extractResult = await this.audioExtractor.extractAudio(videoPath);
      console.log('音频提取完成:', extractResult);

      // 检查是否需要重启服务（基于配置控制）
      if (
        this.enableRebootCheck &&
        this.audioProcessCount >= this.rebootThreshold
      ) {
        console.log(
          `重启检测已启用，当前处理数量${this.audioProcessCount}达到阈值${this.rebootThreshold}，执行重启逻辑`
        );
        await this.handleServiceReboot();
      } else if (
        !this.enableRebootCheck &&
        this.audioProcessCount >= this.rebootThreshold
      ) {
        console.log(
          `重启检测已禁用，当前处理数量${this.audioProcessCount}达到阈值${this.rebootThreshold}，跳过重启逻辑`
        );
      }

      // 处理音频
      await this.audioProcessor.processAudio(extractResult.outputPath);
      // console.log('音频处理完成');

      // 增加处理计数
      this.audioProcessCount++;
    } catch (error) {
      console.error('S5任务执行失败:', error);
    }
  }

  /**
   * 处理服务重启逻辑
   * @private
   */
  private async handleServiceReboot(): Promise<void> {
    console.log(`已处理${this.audioProcessCount}个音频文件，准备重启服务`);

    // 设置重启标志
    this.isRebooting = true;

    try {
      // 调用重启服务方法，不需要等待返回
      void this.audioProcessor.rebootService();
      console.log('已发送重启服务请求');
    } catch (rebootError) {
      console.error('重启服务失败，但继续执行:', rebootError);
    }

    // 重置计数器
    this.audioProcessCount = 0;

    // 等待3分钟
    console.log('等待3分钟后继续处理...');
    await new Promise(resolve => setTimeout(resolve, this.latencyTime));
    console.log('等待时间结束，继续处理任务');

    // 重置重启标志
    this.isRebooting = false;
  }

  /**
   * 设置重启状态
   * @param rebooting 是否正在重启
   */
  setRebooting(rebooting: boolean): void {
    this.isRebooting = rebooting;
  }

  /**
   * 获取当前处理计数
   */
  getProcessCount(): number {
    return this.audioProcessCount;
  }
}

export default S5TaskProcessor;

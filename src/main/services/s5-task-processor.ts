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
  private configPath: string =
    '\\\\192.168.31.99\\\\影视存储\\\\逛逛客户端\\\\ComfyUI\\\\config.json';

  constructor(
    workbenchManager: WorkbenchManager,
    audioExtractor: AudioExtractor,
    audioProcessor: AudioProcessor
  ) {
    this.workbenchManager = workbenchManager;
    this.audioExtractor = audioExtractor;
    this.audioProcessor = audioProcessor;
  }

  /**
   * 读取并解析配置文件
   * @private
   */
  private getConfig(): any {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      console.error('读取配置文件失败:', error);
      // 返回默认配置
      return {
        video_config: [
          {
            reboot: {
              require: false,
              threshold: 20,
            },
          },
        ],
      };
    }
  }

  /**
   * 检查是否需要重启服务
   * @private
   */
  private shouldReboot(): boolean {
    const config = this.getConfig();
    // 获取video_config中的reboot配置
    const rebootConfig = config?.video_config?.[0]?.reboot || {
      require: false,
      threshold: 20,
    };

    // 如果require为false，则不重启
    if (!rebootConfig.require) {
      return false;
    }

    // 否则根据阈值判断是否需要重启
    const threshold = rebootConfig.threshold || 20;
    return this.audioProcessCount >= threshold;
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

    const task = await this.workbenchManager.dequeueTask('s5TasksQueue');
    if (!task) return;
    console.log('执行任务s5');

    try {
      // 处理音频提取任务
      const videoPath = task as string;
      // 提取音频
      const extractResult = await this.audioExtractor.extractAudio(videoPath);
      console.log('音频提取完成:', extractResult);

      // 增加处理计数
      this.audioProcessCount++;

      // 检查是否需要重启服务
      if (this.shouldReboot()) {
        await this.handleServiceReboot();
      }

      // 处理音频
      const processResult = await this.audioProcessor.processAudio(
        extractResult.outputPath
      );
      console.log('音频处理完成:', processResult);

      // 加入S6队列
      // await this.workbenchManager.enqueueTask('s6TasksQueue', videoPath);
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

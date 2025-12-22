import { EventEmitter } from 'events';
import * as fs from 'fs';
import WorkbenchManager, { WorkbenchTaskStatus } from './workbench-manager';
import AudioExtractor from './audio-extractor';
import AudioProcessor from './audio-processing';
import { writeLog, type LogEvent } from '@main/utils/log';

/**
 * S5任务处理器
 * 负责处理音频提取和音频处理任务
 */
class S5TaskProcessor extends EventEmitter {
  private audioExtractor: AudioExtractor;
  private audioProcessor: AudioProcessor;
  private audioProcessCount: number = 0;
  private readonly latencyTime: number = 3 * 60 * 1000; // 3分钟等待时间
  private isRebooting: boolean = false; // 重启标志
  private readonly configPath: string =
    '\\\\192.168.31.99\\影视存储\\逛逛客户端\\ComfyUI\\config.json';
  private enableRebootCheck: boolean = true; // 是否启用重启检测
  private rebootThreshold: number = 5; // 重启阈值

  constructor(audioExtractor: AudioExtractor, audioProcessor: AudioProcessor) {
    super();
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

    // 从队列中取出两个任务
    const fTask = await WorkbenchManager.dequeueTask('s5TasksQueue');
    const lTask = await WorkbenchManager.dequeueTask('s5TasksQueue');

    // 如果没有任务，直接返回
    if (!fTask && !lTask) return;

    console.log('开始执行S5任务');

    try {
      // 准备要处理的任务数组
      const tasks = [];

      if (fTask) {
        const [fVideoPath, fId] = fTask as [string, number];
        tasks.push(this.processSingleTask(fVideoPath, fId, '9000'));
      }

      if (lTask) {
        const [lVideoPath, lId] = lTask as [string, number];
        tasks.push(this.processSingleTask(lVideoPath, lId, '9001'));
      }

      // 并发处理所有任务
      const results = await Promise.allSettled(tasks);

      // 统计成功和失败的任务
      const successfulTasks = results.filter(
        r => r.status === 'fulfilled'
      ).length;
      const failedTasks = results.filter(r => r.status === 'rejected').length;

      console.log(`任务处理完成: ${successfulTasks} 成功, ${failedTasks} 失败`);

      // 增加处理计数（只计算成功的任务）
      this.audioProcessCount += successfulTasks;

      // 检查是否需要重启服务
      if (
        this.enableRebootCheck &&
        this.audioProcessCount >= this.rebootThreshold
      ) {
        console.log(
          `重启检测已启用，当前处理数量 ${this.audioProcessCount} 达到阈值 ${this.rebootThreshold}，执行重启逻辑`
        );
        await this.handleServiceReboot();
      } else if (
        !this.enableRebootCheck &&
        this.audioProcessCount >= this.rebootThreshold
      ) {
        console.log(
          `重启检测已禁用，当前处理数量 ${this.audioProcessCount} 达到阈值 ${this.rebootThreshold}，跳过重启逻辑`
        );
      }
    } catch (error) {
      console.error('S5任务执行失败:', error);
      this.writeLog(`S5任务执行失败: ${error}`, 'error');
    }
  }
  /**
   * 执行S5任务
   * @returns Promise<void>
   */
  async executes(
    fTask: [string, number],
    lTask: [string, number]
  ): Promise<void> {
    // 如果正在重启，跳过当前任务
    if (this.isRebooting) {
      console.log('服务正在重启中，等待3分钟后再继续处理任务');
      return;
    }
    console.log('开始执行newS5任务:', fTask);

    // 如果没有任务，直接返回
    if (!fTask && !lTask) return;
    if (!fTask) return;
    try {
      // 准备要处理的任务数组
      const tasks = [];

      if (fTask) {
        const [fVideoPath, fId] = fTask as [string, number];
        const [lVideoPath, lId] = lTask as [string, number];
        console.log(`任务 ${fId} 开始处理视频: ${fVideoPath}`);
        tasks.push(this.processSingleTask(fVideoPath, fId, '9000'));
        tasks.push(this.processSingleTask(lVideoPath, lId, '9001'));
      }
      console.log(tasks);

      // 并发处理所有任务
      const results = await Promise.allSettled(tasks);

      // 统计成功和失败的任务
      const successfulTasks = results.filter(
        r => r.status === 'fulfilled'
      ).length;
      const failedTasks = results.filter(r => r.status === 'rejected').length;

      console.log(`任务处理完成: ${successfulTasks} 成功, ${failedTasks} 失败`);

      // 增加处理计数（只计算成功的任务）
      this.audioProcessCount += successfulTasks;

      // 检查是否需要重启服务
      if (
        this.enableRebootCheck &&
        this.audioProcessCount >= this.rebootThreshold
      ) {
        console.log(
          `重启检测已启用，当前处理数量 ${this.audioProcessCount} 达到阈值 ${this.rebootThreshold}，执行重启逻辑`
        );
        await this.handleServiceReboot();
      } else if (
        !this.enableRebootCheck &&
        this.audioProcessCount >= this.rebootThreshold
      ) {
        console.log(
          `重启检测已禁用，当前处理数量 ${this.audioProcessCount} 达到阈值 ${this.rebootThreshold}，跳过重启逻辑`
        );
      }
    } catch (error) {
      console.error('S5任务执行失败:', error);
      this.writeLog(`S5任务执行失败: ${error}`, 'error');
    }
  }

  /**
   * 处理单个S5任务
   * @param videoPath 视频路径
   * @param taskId 任务ID
   * @param param 处理参数 ('9000' 或 '9001')
   * @returns Promise<void>
   */
  private async processSingleTask(
    videoPath: string,
    taskId: number,
    param: string
  ): Promise<void> {
    // 提取音频
    const extractResult = await this.audioExtractor.extractAudio(videoPath);
    console.log(`任务 ${taskId} 音频提取完成:`, extractResult);

    // 处理音频，传入参数
    await this.audioProcessor.processAudio(extractResult.outputPath, param);
    console.log(`任务 ${taskId} 音频处理完成`);

    // 通知任务完成
    await WorkbenchManager.updateTaskStatus(
      's5TasksQueue',
      taskId,
      WorkbenchTaskStatus.COMPLETED
    );

    console.log(`任务 ${taskId} 完成`);
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

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}

export default S5TaskProcessor;

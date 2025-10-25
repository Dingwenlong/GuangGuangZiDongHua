import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

// 类型定义
interface AudioProcessorOptions {
  [key: string]: any;
}

interface AudioConfig {
  server: string;
  port: number;
}

interface VideoConfig extends AudioConfig {
  reboot?: {
    require: boolean;
    threshold: number;
  };
}

interface ConfigData {
  audio_config: AudioConfig[];
  video_config: VideoConfig[];
}

interface ProcessedPromptResult {
  prompt_id: string;
  number: number;
  node_errors: object;
}

interface LogEvent {
  message: string;
  type: 'info' | 'error' | 'success' | 'warning' | 'debug';
}

interface StatusObject {
  initialized: boolean;
  processingStatus: string;
  activeConfig: AudioConfig | null;
}

interface ProcessParams {
  audioPath: string;
  videoPath?: string;
  isVideoProcessing: boolean;
}

class AudioProcessor extends EventEmitter {
  private options: AudioProcessorOptions;
  private configPath: string;
  private workflowTemplatePath: string;
  private workflowTemplatePath10: string; // workflow_10模板路径
  private status: StatusObject;
  private processedPrompts: Map<string, string>; // 存储路径和对应的prompt_id
  private audioConfig: AudioConfig | null; // 音频配置
  private videoConfig: VideoConfig | null; // 视频配置

  constructor(options: AudioProcessorOptions = {}) {
    super();
    this.options = options;

    // 配置文件路径
    this.configPath =
      '\\\\192.168.31.99\\\\影视存储\\\\逛逛客户端\\\\ComfyUI\\\\config.json';
    // 支持多个工作流模板
    this.workflowTemplatePath =
      '\\\\192.168.31.99\\\\影视存储\\\\逛逛客户端\\\\ComfyUI\\\\工作流模板\\\\workflow_09.json';
    this.workflowTemplatePath10 =
      '\\\\192.168.31.99\\\\影视存储\\\\逛逛客户端\\\\ComfyUI\\\\工作流模板\\\\workflow_10.json';

    // 系统状态
    this.status = {
      initialized: false,
      processingStatus: '空闲',
      activeConfig: null,
    };

    // 存储配置
    this.audioConfig = null;
    this.videoConfig = null;

    // 存储处理过的prompt
    this.processedPrompts = new Map<string, string>();
  }

  /**
   * 初始化音频处理器
   */
  private async initialize(): Promise<void> {
    try {
      // 加载配置
      await this.loadConfig();
      this.status.initialized = true;
    } catch (error) {
      this.status.initialized = false;
    }
  }

  /**
   * 加载配置文件
   */
  private async loadConfig(): Promise<void> {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      const configData: ConfigData = JSON.parse(configContent);

      if (!configData.audio_config || configData.audio_config.length === 0) {
        throw new Error('配置文件中未找到音频配置');
      }

      if (!configData.video_config || configData.video_config.length === 0) {
        throw new Error('配置文件中未找到视频配置');
      }

      // 加载音频配置
      this.audioConfig = configData.audio_config[0];
      // 加载视频配置
      this.videoConfig = configData.video_config[0];

      // 设置默认活动配置为音频配置
      this.status.activeConfig = this.audioConfig;
    } catch (error) {
      throw new Error(`加载配置文件失败: ${(error as Error).message}`);
    }
  }

  /**
   * 处理音频文件
   * @param audioPath 音频文件路径
   */
  public async processAudio(audioPath: string): Promise<void> {
    try {
      // 首先检查文件是否存在
      if (!fs.existsSync(audioPath)) {
        this.emit('log', {
          message: `音频文件不存在: ${audioPath}`,
          type: 'error',
        } as LogEvent);
        return;
      }

      const params: ProcessParams = {
        audioPath,
        isVideoProcessing: false,
      };

      // 使用完整的处理流程，包括可能的视频处理
      await this.processMediaWithVideo(params);
    } catch (error) {
      this.emit('log', {
        message: `音频处理失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        type: 'error',
      } as LogEvent);
    }
  }

  /**
   * 处理媒体文件并自动处理关联的视频（如果存在）
   * @param params 处理参数
   */
  private async processMediaWithVideo(params: ProcessParams): Promise<void> {
    try {
      // 处理音频
      await this.processMediaFile(params);

      // 检查是否有同名的视频文件需要处理
      const { audioPath } = params;
      const videoPath = audioPath.replace(/\.mp3$/i, '.mp4');

      // 如果视频文件存在且尚未处理过，自动处理视频
      if (fs.existsSync(videoPath) && !this.processedPrompts.has(videoPath)) {
        this.emit('log', {
          message: `发现同名视频文件，开始处理视频: ${path.basename(
            videoPath
          )}`,
          type: 'info',
        } as LogEvent);

        const videoParams: ProcessParams = {
          audioPath,
          videoPath,
          isVideoProcessing: true,
        };

        await this.processMediaFile(videoParams);
      }
    } catch (error) {
      this.emit('log', {
        message: `音视频处理流程失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        type: 'error',
      } as LogEvent);
    }
  }

  /**
   * 处理视频文件
   * @param videoPath 视频文件路径
   * @param audioPath 音频文件路径（与视频同名）
   */
  public async processVideo(
    videoPath: string,
    audioPath: string
  ): Promise<void> {
    try {
      const params: ProcessParams = {
        audioPath,
        videoPath,
        isVideoProcessing: true,
      };
      await this.processMediaFile(params);
    } catch (error) {
      this.emit('log', {
        message: `视频处理失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        type: 'error',
      } as LogEvent);
    }
  }

  /**
   * 获取指定处理类型的配置
   * @param isVideoProcessing 是否为视频处理
   */
  private getConfig(isVideoProcessing: boolean): AudioConfig | null {
    return isVideoProcessing ? this.videoConfig : this.audioConfig;
  }

  /**
   * 通用媒体文件处理方法
   * @param params 处理参数
   */
  private async processMediaFile(params: ProcessParams): Promise<void> {
    try {
      const { audioPath, videoPath, isVideoProcessing } = params;
      const targetPath = isVideoProcessing ? videoPath : audioPath;
      if (!targetPath) {
        this.emit('log', {
          message: `处理${isVideoProcessing ? '视频' : '音频'}时路径为空`,
          type: 'error',
        } as LogEvent);
        return;
      }
      // 自动初始化（如果尚未初始化）
      if (!this.status.initialized) {
        await this.initialize();
        if (!this.status.initialized) {
          return;
        }
      }

      // 获取对应类型的配置
      const activeConfig = this.getConfig(isVideoProcessing);
      if (!activeConfig) {
        this.emit('log', {
          message: `${isVideoProcessing ? '视频' : '音频'}配置不存在`,
          type: 'error',
        } as LogEvent);
        return;
      }

      // 检查是否已经处理过
      if (this.processedPrompts.has(targetPath)) {
        return;
      }

      this.emit('log', {
        message: `开始处理${
          isVideoProcessing ? '视频1' : '音频'
        }: ${path.basename(targetPath)}`,
        type: 'info',
      } as LogEvent);

      // 读取工作流模板（音频使用workflow_09，视频使用workflow_10）
      const templatePath = isVideoProcessing
        ? this.workflowTemplatePath10
        : this.workflowTemplatePath;
      const workflowTemplate = fs.readFileSync(templatePath, 'utf-8');
      let promptData = JSON.parse(workflowTemplate);
      // 替换音频路径
      const escapedAudioPath = audioPath.replace(/\\/g, '\\\\');
      let updatedWorkflow = JSON.stringify(promptData).replace(
        /#AudioUrl#/g,
        escapedAudioPath
      );

      // 如果是视频处理，还需要替换视频路径
      if (isVideoProcessing && videoPath) {
        const escapedVideoPath = videoPath.replace(/\\/g, '\\\\');
        updatedWorkflow = updatedWorkflow.replace(
          /#VideoUrl#/g,
          escapedVideoPath
        );
      }

      promptData = JSON.parse(updatedWorkflow);
      // 调用接口获取promptId
      const promptId = await this.callPromptApi(promptData, isVideoProcessing);
      this.emit('log', {
        message: `获取到${
          isVideoProcessing ? '视频' : '音频'
        }处理任务ID: ${promptId}`,
        type: 'info',
      } as LogEvent);

      // 存储结果并进行后续处理
      if (promptId) {
        this.processedPrompts.set(targetPath, promptId);
        this.emit(
          isVideoProcessing ? 'videoProcessComplete' : 'audioProcessComplete',
          {
            audioPath,
            videoPath,
            promptId,
          }
        );
        // 轮询任务状态
        const historyResult = await this.pollTaskStatus(
          promptId,
          isVideoProcessing
        );
        // 如果任务完成且有结果，调用view下载文件
        if (historyResult && Object.keys(historyResult).length > 0) {
          try {
            // 根据处理类型提取相应的输出数据
            // 音频使用57节点，视频可能在其他节点
            const nodeKey = isVideoProcessing ? '11' : '57'; // 假设视频在58节点，可根据实际情况调整
            const mediaType = isVideoProcessing ? 'gifs' : 'audio';
            const targetData =
              historyResult[promptId]?.outputs?.[nodeKey]?.[mediaType]?.[0];

            if (targetData && Object.keys(targetData).length > 0) {
              // 提取必要的三个参数：filename、subfolder、type，并只保留非空值
              const filteredData: any = {};

              // 检查并添加三个参数，但只添加非空值
              if ('filename' in targetData && targetData.filename) {
                filteredData['filename'] = targetData.filename;
              }
              if ('subfolder' in targetData && targetData.subfolder) {
                filteredData['subfolder'] = targetData.subfolder;
              }
              if ('type' in targetData && targetData.type) {
                filteredData['type'] = targetData.type;
              }

              // 记录提取的参数信息
              const mediaTypeText = isVideoProcessing ? '视频' : '音频';
              this.emit('log', {
                message: `提取的${mediaTypeText}参数(仅非空): ${JSON.stringify(
                  filteredData
                )}`,
                type: 'info',
              } as LogEvent);

              // 对于视频处理，如果没有必要的参数，可以记录警告但不中断处理
              if (isVideoProcessing && Object.keys(filteredData).length === 0) {
                this.emit('log', {
                  message: '视频处理参数全部为空，将使用默认逻辑处理',
                  type: 'warning',
                } as LogEvent);
              }

              await this.fetchViewData(filteredData, params);
            }
          } catch (error) {
            this.emit('log', {
              message: `提取目标数据路径时出错: ${
                error instanceof Error ? error.message : String(error)
              }`,
              type: 'error',
            } as LogEvent);
          }
        }
      }

      return;
    } catch (error) {
      throw error;
    } finally {
      this.status.processingStatus = '空闲';
    }
  }

  /**
   * 轮询任务状态
   * @param promptId 任务ID
   * @param isVideoProcessing 是否为视频处理
   */
  private async pollTaskStatus(
    promptId: string,
    isVideoProcessing: boolean
  ): Promise<any> {
    const activeConfig = this.getConfig(isVideoProcessing);
    if (!activeConfig) {
      return null;
    }

    const { server, port } = activeConfig;
    const normalizedServer = server.startsWith('http')
      ? server
      : `http://${server}`;
    const url = `${normalizedServer}:${port}/history/${promptId}`;
    this.emit('log', {
      message: `轮询任务状态: ${url}`,
      type: 'info',
    } as LogEvent);

    const maxRetries = 60; // 最多重试60次
    const retryInterval = 30 * 1000; // 每30秒轮询一次

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await this.httpGetRequest(url);
        const historyData = JSON.parse(response);
        this.emit('log', {
          message: `轮询任务状态返回数据: ${JSON.stringify(historyData)}`,
          type: 'info',
        } as LogEvent);

        // 检查是否返回了非空对象
        if (historyData && Object.keys(historyData).length > 0) {
          return historyData;
        }
        // 继续等待
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      } catch (error) {
        this.emit('log', {
          message: `轮询任务状态失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
          type: 'error',
        } as LogEvent);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }

    this.emit('log', {
      message: `任务 ${promptId} 轮询超时`,
      type: 'error',
    } as LogEvent);
    return null;
  }

  /**
   * 下载媒体文件并保存到处理的媒体目录
   * @param targetData 包含文件下载参数的数据对象
   * @param params 处理参数
   */
  private async fetchViewData(
    targetData: any,
    params: ProcessParams
  ): Promise<void> {
    if (!this.status.activeConfig) {
      this.emit('log', {
        message: '没有可用的服务器配置',
        type: 'error',
      } as LogEvent);
      return;
    }

    if (!targetData || typeof targetData !== 'object') {
      this.emit('log', {
        message: '下载参数数据无效',
        type: 'error',
      } as LogEvent);
      return;
    }

    try {
      const { server, port } = this.status.activeConfig;
      const { audioPath, videoPath, isVideoProcessing } = params;

      // 确保使用http协议
      const normalizedServer = server.startsWith('http')
        ? server
        : `http://${server}`;

      // 构建查询参数
      const paramsQuery = Object.entries(targetData)
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        )
        .join('&');

      // 构建完整的文件下载URL: http://server:port/view?params
      const fileUrl = `${normalizedServer}:${port}/view?${paramsQuery}`;

      this.emit('log', {
        message: `开始下载${
          isVideoProcessing ? '视频' : '音频'
        }文件，URL: ${fileUrl}`,
        type: 'info',
      } as LogEvent);

      // 获取媒体文件所在目录
      const targetPath = isVideoProcessing ? videoPath : audioPath;
      if (!targetPath) {
        throw new Error('目标路径无效');
      }

      const mediaDir = path.dirname(targetPath);
      // 确保目录存在
      if (!fs.existsSync(mediaDir)) {
        try {
          fs.mkdirSync(mediaDir, { recursive: true });
          this.emit('log', {
            message: `创建媒体目录: ${mediaDir}`,
            type: 'info',
          } as LogEvent);
        } catch (mkdirError: any) {
          throw new Error(`创建媒体目录失败: ${mkdirError.message}`);
        }
      }

      let fileExt = isVideoProcessing ? '.mp4' : '.mp3'; // 默认扩展名
      if (targetData.filename) {
        fileExt = path.extname(targetData.filename);
      }

      // 创建新文件名
      let newFileName: string;
      let originalPath: string = targetPath;

      if (isVideoProcessing && videoPath) {
        // 视频处理 - 使用视频文件名
        originalPath = videoPath;
        const originalVideoName = path.basename(
          videoPath,
          path.extname(videoPath)
        );
        // 如果文件名以S5开头，则改为S6
        if (originalVideoName.startsWith('S5')) {
          newFileName = `S6${originalVideoName.substring(2)}${fileExt}`;
        } else {
          newFileName = `${originalVideoName}${fileExt}`;
        }
      } else if (audioPath) {
        // 音频处理 - 使用音频文件名（不再添加随机数）
        originalPath = audioPath;
        const originalAudioName = path.basename(
          audioPath,
          path.extname(audioPath)
        );
        newFileName = `${originalAudioName}${fileExt}`;
      } else {
        throw new Error('音频路径无效');
      }

      this.emit('log', {
        message: `新文件名: ${newFileName}`,
        type: 'info',
      } as LogEvent);

      // 保存文件的完整路径
      let savePath = path.join(mediaDir, newFileName);

      // 对于音频处理，直接删除原文件（如果存在）以确保可以使用原名替代
      if (!isVideoProcessing && audioPath && fs.existsSync(audioPath)) {
        try {
          fs.unlinkSync(audioPath);
          this.emit('log', {
            message: `已删除原音频文件以便使用原名替代: ${audioPath}`,
            type: 'info',
          } as LogEvent);
        } catch (deleteError) {
          this.emit('log', {
            message: `删除原音频文件失败: ${
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError)
            }`,
            type: 'warning',
          } as LogEvent);
        }
      }

      // 对于视频文件，如果已存在则添加时间戳（保持原有逻辑）
      if (isVideoProcessing && fs.existsSync(savePath)) {
        const stats = fs.statSync(savePath);
        if (stats.size > 0) {
          const nameWithoutExt = path.basename(savePath, fileExt);
          newFileName = `${nameWithoutExt}${fileExt}`;
          savePath = path.join(mediaDir, newFileName);
          this.emit('log', {
            message: `视频处理完成: ${newFileName}`,
            type: 'warning',
          } as LogEvent);
        }
      }

      // 下载文件
      await this.downloadFile(fileUrl, savePath);

      // 验证下载的文件是否存在且大小合理
      if (!fs.existsSync(savePath) || fs.statSync(savePath).size === 0) {
        throw new Error(`文件下载失败: 保存的文件为空或不存在 (${savePath})`);
      }

      // 由于我们已经在下载前删除了原音频文件，这里不再重复删除
      // 保留日志记录以表明处理完成
      if (!isVideoProcessing && audioPath) {
        this.emit('log', {
          message: `音频处理完成，已使用新文件替代原文件`,
          type: 'info',
        } as LogEvent);
      }

      this.emit('log', {
        message: `${
          isVideoProcessing ? '视频' : '音频'
        }文件下载成功，已保存到: ${savePath}`,
        type: 'success',
      } as LogEvent);

      if (isVideoProcessing) {
        this.emit('s6OkCallback', videoPath);
      }

      this.emit('fileDownloaded', {
        originalUrl: fileUrl,
        savePath: savePath,
        newFileName: newFileName,
        isVideo: isVideoProcessing,
        originalPath: originalPath,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit('log', {
        message: `文件下载失败: ${errorMessage}`,
        type: 'error',
      } as LogEvent);
      throw error; // 重新抛出错误以便上层处理
    }
  }

  /**
   * 下载文件到指定路径
   * @param fileUrl 文件URL
   * @param savePath 保存路径
   */
  private async downloadFile(fileUrl: string, savePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpModule = fileUrl.startsWith('https') ? https : http;

      // 确保目录存在
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (mkdirError: any) {
          reject(mkdirError);
          return;
        }
      }

      const fileStream = fs.createWriteStream(savePath);
      httpModule
        .get(fileUrl, response => {
          if (response.statusCode !== 200) {
            fileStream.close();
            const error = new Error(`下载失败: HTTP ${response.statusCode}`);
            this.emit('log', {
              message: error.message,
              type: 'error',
            } as LogEvent);
            reject(error);
            return;
          }

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();

            // 验证文件是否成功写入
            if (fs.existsSync(savePath) && fs.statSync(savePath).size > 0) {
              resolve();
            } else {
              const error = new Error(`文件下载失败: 保存文件为空或不存在`);
              reject(error);
            }
          });
        })
        .on('error', error => {
          fileStream.close();
          this.emit('log', {
            message: `HTTP请求错误: ${error.message}`,
            type: 'error',
          } as LogEvent);
          reject(error);
        });
    });
  }

  /**
   * 执行HTTP GET请求的工具方法
   * @param url 请求URL
   */
  private httpGetRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const httpModule = url.startsWith('https') ? https : http;

      const req = httpModule.get(url, (res: any) => {
        let responseData = '';

        res.on('data', (chunk: any) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseData);
          } else {
            reject(new Error(`HTTP error! Status: ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error: Error) => {
        reject(error);
      });

      req.end();
    });
  }

  /**
   * 调用 /prompt API
   * @param promptData 提示数据
   * @param isVideoProcessing 是否为视频处理
   */
  private async callPromptApi(
    promptData: any,
    isVideoProcessing: boolean = false
  ): Promise<string | null> {
    const activeConfig = this.getConfig(isVideoProcessing);
    if (!activeConfig) {
      return null;
    }

    const { server, port } = activeConfig;

    // 确保使用http协议
    const normalizedServer = server.startsWith('http')
      ? server
      : `http://${server}`;
    const url = `${normalizedServer}:${port}/prompt`;
    this.emit('log', {
      message: `调用API: ${url}获取prompt_id`,
      type: 'info',
    } as LogEvent);

    // 构建请求数据
    const requestDataObj = {
      client_id: 'hanliyan_604984af-ffbf-4b0f-9820-a23d2d568093',
      prompt: promptData,
    };

    const requestData = JSON.stringify(requestDataObj);

    return new Promise(resolve => {
      // 固定使用http模块
      const httpModule = http;

      const options: http.RequestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestData),
        },
      };

      const req = httpModule.request(url, options, (res: any) => {
        let responseData = '';
        res.on('data', (chunk: any) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            // 尝试解析响应体
            const parsedResponse = JSON.parse(responseData);

            // 检查是否有prompt_id字段
            if (parsedResponse.prompt_id) {
              resolve(parsedResponse.prompt_id);
            } else {
              resolve(null);
            }
          } catch (error) {
            resolve(null);
          }
        });
      });

      req.on('error', (error: Error) => {
        this.emit('log', {
          message: `[callPromptApi] 请求错误: ${error.message}`,
          type: 'error',
        } as LogEvent);
        resolve(null);
      });

      req.write(requestData);

      req.end();
    });
  }

  /**
   * 获取处理统计信息
   */
  public getProcessingStats(): {
    initialized: boolean;
    processingStatus: string;
    activeConfig: AudioConfig | null;
    processedCount: number;
  } {
    return {
      initialized: this.status.initialized,
      processingStatus: this.status.processingStatus,
      activeConfig: this.status.activeConfig,
      processedCount: this.processedPrompts.size,
    };
  }

  /**
   * 获取指定音频的prompt_id
   */
  public getPromptId(audioPath: string): string | undefined {
    return this.processedPrompts.get(audioPath);
  }

  /**
   * 清除指定音频的处理记录
   */
  public clearProcessedRecord(audioPath: string): void {
    if (this.processedPrompts.has(audioPath)) {
      this.processedPrompts.delete(audioPath);
    }
  }

  /**
   * 清除所有处理记录
   */
  public clearAllProcessedRecords(): void {
    const count = this.processedPrompts.size;
    this.processedPrompts.clear();
  }

  /**
   * 重新加载配置
   */
  public async reloadConfig(): Promise<void> {
    try {
      await this.loadConfig();
      this.emit('log', {
        message: '配置已重新加载',
        type: 'success',
      } as LogEvent);
    } catch (error) {
      this.emit('log', {
        message: `重新加载配置失败: ${(error as Error).message}`,
        type: 'error',
      } as LogEvent);
    }
  }

  /**
   * 获取视频配置中的重启参数
   */
  public getVideoRebootConfig(): {
    require: boolean;
    threshold: number;
  } | null {
    if (this.videoConfig?.reboot) {
      return this.videoConfig.reboot;
    }
    return null;
  }
}

export default AudioProcessor;

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { writeLog, type LogEvent } from '@main/utils/log';

// 类型定义
interface AudioProcessorOptions {
  [key: string]: any;
}

interface StatusObject {
  initialized: boolean;
  processingStatus: string;
  activeConfig: any;
}

interface ProcessParams {
  audioPath: string;
  videoPath?: string;
  isVideoProcessing: boolean;
}

class AudioProcessor extends EventEmitter {
  private options: AudioProcessorOptions;
  private workflowTemplatePath: string;
  private status: StatusObject;
  private processedPrompts: Map<string, string>; // 存储路径和对应的prompt_id

  // 新增：固定服务器地址
  private readonly fixedServer: string = 'http://192.168.31.222';

  constructor(options: AudioProcessorOptions = {}) {
    super();
    this.options = options;

    // 统一的工作流模板（路径保持不变）
    this.workflowTemplatePath =
      '\\\\192.168.31.99\\\\影视存储\\\\逛逛客户端\\\\ComfyUI\\\\工作流模板\\\\workflow_1208.json'; // 沿用原文件名

    // 系统状态
    this.status = {
      initialized: true, // 简化：始终视为已初始化
      processingStatus: '空闲',
      activeConfig: null,
    };

    this.processedPrompts = new Map<string, string>();
  }

  /**
   * 处理文件 - 入口 (修改: 合并逻辑，只进行一次处理)
   * @param audioPath 音频文件路径
   * @param port 端口参数
   */
  public async processAudio(audioPath: string, port: string): Promise<void> {
    try {
      // 1. 文件检查
      if (!fs.existsSync(audioPath)) {
        this.emit('log', {
          message: `音频文件不存在: ${audioPath}`,
          type: 'error',
        } as LogEvent);
        return;
      }

      this.writeLog(`开始处理音频文件: ${audioPath}`, 'info');

      // 2. 推导出视频路径并检查是否存在
      const videoPath = audioPath.replace(/\.mp3$/i, '.mp4');
      const videoExists = fs.existsSync(videoPath);

      // 3. 构造统一参数
      const params: ProcessParams = {
        audioPath,
        // 如果视频不存在，则 videoPath 可能是 undefined
        videoPath: videoExists ? videoPath : undefined,
        // 如果视频存在，标记为 isVideoProcessing=true，确保下载和 S4/S5 逻辑正确
        isVideoProcessing: true,
      };

      // 4. 调用统一的处理方法
      await this.processMediaFile(params, port);
    } catch (error) {
      this.emit('log', {
        message: `S5初始处理失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        type: 'error',
      } as LogEvent);
      this.writeLog(
        `S5初始处理失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error'
      );
    }
  }

  /**
   * 统一媒体文件处理方法 (核心逻辑)
   * @param params 处理参数 (包含 audioPath, videoPath, isVideoProcessing 标记)
   * @param port 端口参数
   * @returns 是否处理成功
   */
  private async processMediaFile(
    params: ProcessParams,
    port: string
  ): Promise<boolean> {
    try {
      const { audioPath, videoPath, isVideoProcessing } = params;
      // 目标路径：优先视频（用于去重和日志），其次音频
      const targetPath = videoPath || audioPath;

      this.status.processingStatus = '处理中'; // 设置状态

      // 定义背景音乐的基础路径 (UNC 路径)
      const BGM_BASE_PATH =
        '\\\\192.168.31.99\\影视存储\\逛逛客户端\\ComfyUI\\示例音频';

      // 读取统一的工作流模板
      const workflowTemplate = fs.readFileSync(
        this.workflowTemplatePath,
        'utf-8'
      );
      let promptData = JSON.parse(workflowTemplate);

      let updatedWorkflow = JSON.stringify(promptData);
      let backgroundVideoPath = '';
      let backgroundMusicPath = '';

      // --- 1. 路径替换：音频、视频、端口 ---

      // 替换音频路径
      const escapedAudioPath = audioPath.replace(/\\/g, '\\\\');
      updatedWorkflow = updatedWorkflow.replace(
        /#AudioUrl#/g,
        escapedAudioPath
      );

      // 替换视频路径
      // 如果 videoPath 不存在，则替换为空字符串
      const escapedVideoPath = videoPath
        ? videoPath.replace(/\\/g, '\\\\')
        : '';
      updatedWorkflow = updatedWorkflow.replace(
        /#VideoUrl#/g,
        escapedVideoPath
      );

      // 替换端口参数
      updatedWorkflow = updatedWorkflow.replace(/#Port#/g, port);

      // --- 2. 背景音乐路径逻辑（统一计算一次最终路径） ---

      // 如果 videoPath 存在，则使用视频处理的 BGM 逻辑 (随机 BGM)
      // 视频处理逻辑：随机选择背景音乐
      const bgmFiles = [
        '背景音乐1.MP3',
        '背景音乐2.MP3',
        '背景音乐3.MP3',
        '背景音乐4.MP3',
        '背景音乐5.MP3',
        '背景音乐6.MP3',
      ];
      const randomIndex = Math.floor(Math.random() * bgmFiles.length);
      backgroundMusicPath = path.join(BGM_BASE_PATH, bgmFiles[randomIndex]);

      // 否则使用音频处理的 BGM 逻辑 (类别 BGM)
      const parentDir = path.dirname(audioPath || '');

      const folderName = path.basename(parentDir);

      // 尝试从文件夹名称中提取类目ID
      const parts = folderName.split('---');
      let categoryId = '';

      // 假设“大家电”这个类目在分隔后的第 4 个位置 (索引 3)
      if (parts.length >= 4) {
        categoryId = parts[3];
      }
      // console.log('类目ID:', categoryId); // 移除 console.log

      const categoryArr = [
        '彩妆护肤',
        '宠物用品',
        '大家电',
        '健康品类',
        '母婴用品',
        '生活电器',
        '时尚穿搭',
      ];
      let categoryBgmFileName = '';
      categoryArr.includes(categoryId)
        ? (categoryBgmFileName = '示例声音-女声.MP3')
        : (categoryBgmFileName = '');

      const categoryBgmPath = path.join(BGM_BASE_PATH, categoryBgmFileName);
      const fallbackBgmPath = path.join(BGM_BASE_PATH, '示例声音.MP3');

      // 检查类目背景音乐文件是否存在，且文件名不为空，不存在则使用备用文件
      if (categoryId && categoryBgmFileName && fs.existsSync(categoryBgmPath)) {
        backgroundVideoPath = categoryBgmPath;
      } else {
        backgroundVideoPath = fallbackBgmPath;
      }

      const escapedBackgroundVideoPath = backgroundVideoPath.replace(
        /\\/g,
        '\\\\'
      );

      // 替换 #BgmUrl#
      updatedWorkflow = updatedWorkflow.replace(
        /#SampleUrl#/g,
        escapedBackgroundVideoPath
      );

      const escapedBackgroundMusicPath = backgroundMusicPath.replace(
        /\\/g,
        '\\\\'
      );

      // 音频处理使用 #SampleUrl#
      updatedWorkflow = updatedWorkflow.replace(
        /#BgmUrl#/g,
        escapedBackgroundMusicPath
      );

      promptData = JSON.parse(updatedWorkflow);
      console.log('promptData', promptData); // 移除 console.log

      // 调用接口获取promptId
      const promptId = await this.callPromptApi(promptData, port);
      console.log('promptId', promptId); // 移除 console.log

      // 存储结果并进行后续处理
      if (promptId) {
        this.processedPrompts.set(targetPath, promptId);
        // 轮询任务状态（16秒间隔）
        const historyResult = await this.pollTaskStatus(promptId, port);
        console.log('historyResult', JSON.stringify(historyResult)); // 移除 console.log

        if (historyResult && Object.keys(historyResult).length > 0) {
          try {
            if (historyResult[promptId]?.status.status_str !== 'success') {
              throw new Error(
                `任务 ${promptId} 处理失败,状态: ${historyResult[promptId]?.status.status_str}`
              );
            }
            const nodeKey = '86';
            const mediaType = 'videos';
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
                filteredData['subfolder'] = targetData.subfolder.replace(
                  /\\/g,
                  '/'
                );
              }
              if ('type' in targetData && targetData.type) {
                filteredData['type'] = targetData.type;
              }

              // 对于视频处理，如果没有必要的参数，可以记录警告但不中断处理
              if (isVideoProcessing && Object.keys(filteredData).length === 0) {
                this.emit('log', {
                  message: '视频处理参数全部为空，下载视频失败',
                  type: 'warning',
                } as LogEvent);
              }

              await this.fetchViewData(filteredData, params, port);
            } else {
              throw new Error('未找到处理后的媒体文件数据');
            }
          } catch (error) {
            this.emit('log', {
              message: `提取目标数据路径时出错: ${
                error instanceof Error ? error.message : String(error)
              }`,
              type: 'error',
            } as LogEvent);
            throw new Error(
              `提取目标数据路径时出错: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        } else {
          throw new Error(`任务 ${promptId} 轮询超时,处理失败`);
        }
      }

      return true;
    } catch (error) {
      throw error;
    } finally {
      this.status.processingStatus = '空闲';
    }
  }

  /**
   * 调用 /prompt API (固定IP)
   */
  private async callPromptApi(
    promptData: any,
    port: string
  ): Promise<string | null> {
    const normalizedServer = this.fixedServer; // 使用固定的 IP
    const url = `${normalizedServer}:${port}/prompt`;
    console.log('请求url：', url);

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
            const parsedResponse = JSON.parse(responseData);

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
   * 轮询任务状态 (固定IP)
   */
  private async pollTaskStatus(promptId: string, port: string): Promise<any> {
    const normalizedServer = this.fixedServer; // 使用固定的 IP
    const url = `${normalizedServer}:${port}/history/${promptId}`;

    const maxRetries = 60; // 最多重试60次
    const retryInterval = 16 * 1000; // 16秒轮询一次

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await this.httpGetRequest(url);
        const historyData = JSON.parse(response);

        if (historyData && Object.keys(historyData).length > 0) {
          return historyData;
        }
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
    this.writeLog(`任务 ${promptId} 轮询超时`, 'error');
    return null;
  }

  /**
   * 下载媒体文件并保存到处理的媒体目录 (固定IP)
   */
  private async fetchViewData(
    targetData: any,
    params: ProcessParams,
    port: string
  ): Promise<void> {
    const { isVideoProcessing } = params;

    if (!targetData || typeof targetData !== 'object') {
      this.emit('log', {
        message: '下载参数数据无效',
        type: 'error',
      } as LogEvent);
      return;
    }

    try {
      const normalizedServer = this.fixedServer; // 使用固定的 IP
      const { audioPath, videoPath } = params;

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
      let originalVideoName: string = '';

      if (isVideoProcessing && videoPath) {
        // 视频处理 - 使用视频文件名
        originalVideoName = path.basename(videoPath, path.extname(videoPath));
        // 如果文件名以S4开头，则改为S5
        if (originalVideoName.startsWith('S4')) {
          newFileName = `S5${originalVideoName.substring(2)}${fileExt}`;
        } else {
          newFileName = `${originalVideoName}${fileExt}`;
        }
      } else if (audioPath) {
        // 音频处理 - 使用音频文件名
        const originalAudioName = path.basename(
          audioPath,
          path.extname(audioPath)
        );
        newFileName = `${originalAudioName}${fileExt}`;
      } else {
        throw new Error('音频路径无效');
      }

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
          // 保持原有逻辑，但这里应该只存在处理后的文件，无需添加时间戳，沿用之前的逻辑
          // 如果文件已存在，说明是上次处理成功的，这里不再处理，避免重复。
          // 但如果流程走到这里，说明是新下载的文件，所以这里逻辑保留原意：检查文件是否在之前已存在
          const nameWithoutExt = path.basename(savePath, fileExt);
          newFileName = `${nameWithoutExt}${fileExt}`;
          savePath = path.join(mediaDir, newFileName);
          this.emit('log', {
            message: `视频文件已存在，但流程仍在进行，可能发生冲突`,
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

      // 如果是视频处理且成功生成了S5文件，删除原始的S4视频和音频文件
      if (
        isVideoProcessing &&
        videoPath &&
        originalVideoName.startsWith('S4')
      ) {
        try {
          // 删除原始S4视频文件
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
          }

          // 删除对应的S4音频文件（将.mp4替换为.mp3）
          const audioFilePath = videoPath.replace(/\.mp4$/i, '.mp3');
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
          }

          this.emit('log', {
            message: `已删除原始S4视频和对应的音频文件`,
            type: 'info',
          } as LogEvent);
        } catch (deleteError) {
          this.emit('log', {
            message: `删除原始S4文件时出错: ${
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError)
            }`,
            type: 'warning',
          } as LogEvent);
          this.writeLog(
            `S5操作中，删除原始S4文件时出错: ${
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError)
            }`,
            'warning'
          );
        }
      }

      try {
        // 获取当前视频所在的S4文件夹路径
        const currentDir = path.dirname(savePath);
        const parentDir = path.dirname(currentDir);
        const dirName = path.basename(currentDir);
        const fileName = path.basename(savePath);

        // 步骤1: 只将文件名更改为S5开头
        if (fileName.startsWith('S4')) {
          const newFileName = fileName.replace('S4', 'S5');
          const newFilePath = path.join(currentDir, newFileName);

          if (fs.existsSync(savePath) && savePath !== newFilePath) {
            // 如果目标文件已存在，先删除它
            if (fs.existsSync(newFilePath)) {
              fs.unlinkSync(newFilePath);
            }
            // 重命名文件
            fs.renameSync(savePath, newFilePath);
            savePath = newFilePath;

            this.emit('log', {
              message: `已将文件重命名为S5开头: ${newFileName}`,
              type: 'info',
            } as LogEvent);
          }
        }

        // 步骤2: 检查当前文件夹下是否有四个S5开头的文件
        if (dirName.startsWith('S4')) {
          try {
            // 获取当前文件夹下所有以S5开头的文件
            const files = fs.readdirSync(currentDir);
            const s5Files = files.filter(
              file => file.startsWith('S5') && file.endsWith('.mp4')
            );

            this.emit('log', {
              message: `检测到当前文件夹中S5开头的视频文件数量: ${s5Files.length}`,
              type: 'info',
            } as LogEvent);

            // 当有四个S5文件时，将外面一层文件夹的S4前缀改为S5
            if (s5Files.length === 4) {
              // 创建对应的S5文件夹路径
              const newDirName = dirName.replace('S4', 'S5');
              const newDirPath = path.join(parentDir, newDirName);

              // 如果S5文件夹不存在，则重命名整个S4文件夹
              if (!fs.existsSync(newDirPath)) {
                fs.renameSync(currentDir, newDirPath);
                this.emit('log', {
                  message: `已将文件夹 ${dirName} 重命名为 ${newDirName}`,
                  type: 'success',
                } as LogEvent);

                // 构建四个文件的完整路径数组
                const updatedFilePaths = s5Files.map(file =>
                  path.join(newDirPath, file)
                );

                // 触发s5OkCallback事件
                this.emit('s5OkCallback', updatedFilePaths);
                this.emit('log', {
                  message: `已触发s5OkCallback`,
                  type: 'success',
                } as LogEvent);
                this.writeLog(
                  `S5四个文件处理完成，已触发s5OkCallback，传入${
                    updatedFilePaths.length
                  }个文件,文件路径为: ${updatedFilePaths.join(', ')}`
                );
              } else {
                this.emit('log', {
                  message: `目标文件夹 ${newDirName} 已存在，无法重命名`,
                  type: 'warning',
                } as LogEvent);
              }
            }
          } catch (checkError) {
            this.emit('log', {
              message: `检查文件夹中S5文件数量时出错: ${
                checkError instanceof Error
                  ? checkError.message
                  : String(checkError)
              }`,
              type: 'warning',
            } as LogEvent);
            this.writeLog(
              `检查文件夹中S5文件数量时出错: ${
                checkError instanceof Error
                  ? checkError.message
                  : String(checkError)
              }`
            );
          }
        }
      } catch (folderError) {
        this.emit('log', {
          message: `处理文件夹时出错: ${
            folderError instanceof Error
              ? folderError.message
              : String(folderError)
          }`,
          type: 'warning',
        } as LogEvent);
        this.writeLog(
          `S5处理文件夹时出错: ${
            folderError instanceof Error
              ? folderError.message
              : String(folderError)
          }`
        );
      }
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
   * 辅助方法：服务重启
   */
  public async rebootService(): Promise<void> {
    const rebootUrl = 'http://192.168.31.222:9001/api/easyuse/reboot';
    try {
      this.emit('log', {
        message: `正在请求服务重启: ${rebootUrl}`,
        type: 'info',
      } as LogEvent);
      await this.httpGetRequest(rebootUrl);
      this.emit('log', {
        message: '服务重启请求发送成功',
        type: 'success',
      } as LogEvent);
    } catch (error) {
      this.emit('log', {
        message: `服务重启请求失败: ${(error as Error).message}`,
        type: 'error',
      } as LogEvent);
    }
  }

  /**
   * 辅助方法：下载文件
   */
  private downloadFile(fileUrl: string, savePath: string): Promise<void> {
    const isHttps = fileUrl.startsWith('https');
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(savePath);

      const request = httpModule.get(fileUrl, res => {
        if (res.statusCode !== 200) {
          fileStream.close();
          fs.unlink(savePath, () => {}); // 删除部分下载的文件
          return reject(
            new Error(`下载失败，状态码: ${res.statusCode} (${fileUrl})`)
          );
        }

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          // 确保文件大小大于0
          if (fs.statSync(savePath).size > 0) {
            resolve();
          } else {
            fs.unlink(savePath, () => {});
            reject(new Error(`下载文件为空: ${savePath}`));
          }
        });
      });

      request.on('error', err => {
        fileStream.close();
        fs.unlink(savePath, () => {}); // 删除部分下载的文件
        reject(err);
      });

      request.end();
    });
  }

  /**
   * 辅助方法：HTTP GET 请求
   */
  private httpGetRequest(url: string): Promise<string> {
    const isHttps = url.startsWith('https');
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.get(url, res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(
              new Error(
                `请求失败，状态码: ${res.statusCode} URL: ${url} 响应: ${data}`
              )
            );
          }
        });
      });

      req.on('error', err => {
        reject(err);
      });

      req.end();
    });
  }

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}

export default AudioProcessor;

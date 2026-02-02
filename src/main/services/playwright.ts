import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import ffmpeg from 'fluent-ffmpeg';
import { FFmpegUtil } from '../lib/ffmpeg';
import { writeLog, type LogEvent } from '@main/utils/log';

class PlaywrightScript extends EventEmitter {
  // 共享浏览器实例
  private static browser: any = null;
  private static browserUserDataDir: string = '';
  private static isBrowserReady: boolean = false;
  private static browserInitPromise: Promise<void> | null = null;

  public async okCallback(videoPath: string) {
    this.emit('s2OkCallback', videoPath);
  }

  /**
   * 视频去水印处理
   */
  // 初始化浏览器实例
  private static async initBrowser() {
    // 检查浏览器实例是否存在且可用，如果不存在或已关闭，则重新初始化
    if (!PlaywrightScript.browser || !PlaywrightScript.isBrowserReady) {
      if (PlaywrightScript.browserInitPromise) {
        return PlaywrightScript.browserInitPromise;
      }

      PlaywrightScript.browserInitPromise = new Promise(async resolve => {
        try {
          const username = os.userInfo().username;
          PlaywrightScript.browserUserDataDir = path.join(
            'C:\\',
            `kaipai_${username}_data`
          );

          // 确保用户数据目录存在
          if (!fs.existsSync(PlaywrightScript.browserUserDataDir)) {
            fs.mkdirSync(PlaywrightScript.browserUserDataDir, {
              recursive: true,
            });
          }

          // 启动浏览器
          PlaywrightScript.browser = await chromium.launchPersistentContext(
            PlaywrightScript.browserUserDataDir,
            {
              channel: 'chrome',
              headless: false,
              viewport: null,
              acceptDownloads: true,
              // downloadsPath: downloadDir,
            }
          );

          PlaywrightScript.isBrowserReady = true;
          resolve();
        } catch (error) {
          console.error('初始化浏览器失败:', error);
          resolve();
        } finally {
          PlaywrightScript.browserInitPromise = null;
        }
      });

      return PlaywrightScript.browserInitPromise;
    }
  }

  public async runWatermarkRemoval(filePath: string, targetDir?: string) {
    let page: any = null;
    try {
      const downloadDir = targetDir
        ? path.resolve(targetDir)
        : path.dirname(filePath);

      // 确保目标目录存在
      fs.mkdirSync(downloadDir, { recursive: true });

      // 创建专用临时文件夹（保留以便后续使用）
      const tempFolder = path.join(downloadDir, 'ffmpeg_temp');
      fs.mkdirSync(tempFolder, { recursive: true });
      this.emit('log', {
        message: `创建临时文件夹: ${tempFolder}`,
        type: 'info',
      });

      // 验证临时文件夹可写性
      try {
        const testFile = path.join(tempFolder, 'test_write_permission.tmp');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        this.emit('log', {
          message: `临时文件夹可正常写入: ${tempFolder}`,
          type: 'info',
        });
      } catch (err) {
        throw new Error(`临时文件夹无写入权限: ${(err as Error).message}`);
      }

      this.emit('log', {
        message: `开始处理视频去水印：${filePath}`,
        type: 'info',
      });
      this.writeLog(`开始处理视频去水印：${filePath}`, 'info');

      // 初始化浏览器实例
      await PlaywrightScript.initBrowser();
      if (!PlaywrightScript.browser) {
        throw new Error('无法初始化浏览器实例');
      }

      // 创建新标签页
      page = await PlaywrightScript.browser.newPage();
      await page.goto('https://www.kaipai.com/video-tool/remove-watermark');
      await page.waitForLoadState('networkidle');

      // 登录状态检测
      this.emit('log', { message: '检测是否已登录', type: 'info' });
      const avatarSelector = '.AccountAction_accountAvatar__BVL0g';
      const elementCount = await page.locator(avatarSelector).count();
      const isLoggedIn = elementCount > 0;

      if (!isLoggedIn) {
        this.emit('log', { message: '未登录，触发登录操作', type: 'info' });
        const loginButton = await page.waitForSelector('.iconfont-legacy', {
          timeout: 10000,
        });
        await loginButton.click();

        this.emit('log', { message: '等待用户完成登录...', type: 'info' });
        await page.waitForSelector('.index_accountAvatar__gOrHw', {
          timeout: 300000, // 5分钟登录超时
          state: 'visible',
        });
        this.emit('log', { message: '登录成功，继续处理', type: 'success' });
      } else {
        this.emit('log', { message: '已登录，继续处理', type: 'success' });
      }

      // 验证文件路径
      if (!filePath || !fs.existsSync(filePath)) {
        const errorMsg = filePath
          ? `文件不存在，请检查路径: ${filePath}`
          : '未提供有效的文件路径';
        throw new Error(errorMsg);
      }

      // 上传文件
      const uploadArea = await page.waitForSelector(
        '.UploadContentV2_cardRightBox__s8gmc',
        { timeout: 1 * 60 * 1000 } // 一分钟等待时间
      );
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        uploadArea.click(),
      ]);
      await fileChooser.setFiles(filePath);
      this.emit('log', { message: `${filePath}上传成功`, type: 'success' });

      // 处理分类选择
      await page.waitForSelector('.index_categorgList__dF7ji', {
        timeout: 60000,
      });
      const firstCategorySelector =
        '.index_categorgList__dF7ji > .index_categoryItem__pPv2U:nth-child(1)';
      const firstCategory = await page.waitForSelector(firstCategorySelector, {
        timeout: 60000,
      });
      await firstCategory.click();

      // 开始处理
      const startBtnSelector = '.index_button__WWpyb';
      const startButton = await page.waitForSelector(startBtnSelector, {
        timeout: 60000,
      });
      await startButton.click();
      this.emit('log', { message: `${filePath}处理开始`, type: 'info' });
      this.writeLog(`${filePath}上传成功，开始处理`, 'info');

      // 点击开始后等待30秒
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));
      console.log('等待30秒后继续,检测列表第一个的导出按钮');

      // 全局超时和检测间隔设置
      const maxWaitTime = 60 * 60 * 1000; // 1小时
      const checkInterval = 30 * 1000; // 30秒

      let exportButton: any = null;
      const exportBtnStart = Date.now();
      console.log(`开始检测导出按钮，${exportBtnStart}`);

      while (Date.now() - exportBtnStart < maxWaitTime) {
        console.log(`循环内当前检测时间：${Date.now()}`);
        exportButton = await page
          .locator('.index_trackList__1mQ3P')
          .locator('.index_trackItem__vo4uQ ')
          .first()
          .locator('.index_button__Zm8pL');

        if (exportButton) {
          const isVisible = await exportButton.isVisible();
          const isEnabled = await exportButton.isEnabled();
          if (isVisible && isEnabled) {
            console.log('导出按钮可见且可用，准备点击导出');
            break;
          }
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!exportButton) {
        throw new Error(`导出按钮未找到或超时不可用,文件${filePath}出错`);
      }

      // 获取原始文件名（不包含扩展名），用于匹配下载的文件
      const originalFileName = path.basename(filePath, path.extname(filePath));

      // 监听下载事件
      let allDownloads: any[] = [];
      const handleDownload = (download: any) => {
        const downloadFileName = download.suggestedFilename();
        allDownloads.push(download);
        this.emit('log', {
          message: `检测到下载文件: ${downloadFileName}，文件路径将保存在: ${downloadDir}`,
          type: 'info',
        });
        this.writeLog(
          `检测到下载文件: ${downloadFileName}，文件路径将保存在: ${downloadDir}`,
          'info'
        );
      };

      page.on('download', handleDownload);

      // 等待下载事件 - 只处理与原始文件匹配的下载
      const downloadStart = Date.now();
      let targetDownload: any = null;

      try {
        await exportButton.click();

        while (Date.now() - downloadStart < maxWaitTime) {
          // 遍历所有下载，查找匹配原始文件名的下载
          for (const download of allDownloads) {
            const downloadFileName = download.suggestedFilename();
            // 检查下载文件名是否包含原始文件名的关键部分
            if (downloadFileName.includes(originalFileName)) {
              targetDownload = download;
              this.emit('log', {
                message: `找到匹配的下载文件: ${downloadFileName}`,
                type: 'success',
              });

              break;
            }
          }

          if (targetDownload) {
            break;
          }

          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
      } catch (err: any) {
        this.emit('log', {
          message: `下载触发过程出错: ${err.message}`,
          type: 'error',
        });
        this.writeLog(`下载触发过程出错: ${err.message}`, 'info');
        page.off('download', handleDownload);
        return { success: false, message: `下载触发失败: ${err.message}` };
      }

      if (!targetDownload) {
        this.emit('log', {
          message: `未捕获到与原始文件匹配的下载（期望包含: ${originalFileName}）`,
          type: 'warning',
        });
        this.writeLog(
          `未捕获到与原始文件匹配的下载（期望包含: ${originalFileName}）`,
          'error'
        );
        return { success: false, message: '未捕获到匹配的下载文件' };
      } else {
        // 移除事件监听器
        page.off('download', handleDownload);
        const downloadFileName = targetDownload.suggestedFilename();
        this.writeLog(`监听到匹配的下载文件: ${downloadFileName}`, 'info');
        this.emit('log', {
          message: `监听到匹配的下载文件: ${downloadFileName}`,
          type: 'info',
        });
      }

      this.emit('log', { message: `下载完成，开始处理文件`, type: 'info' });

      // 处理下载文件（使用Y1作为中间格式，处理后改为S2）
      let targetPath: any = null;
      const uuidPattern =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      const preDownloadFiles = new Set(fs.readdirSync(downloadDir));

      for (const download of allDownloads) {
        const fileName = download.suggestedFilename();
        const isUuidFile = uuidPattern.test(fileName);

        if (!isUuidFile) {
          let processedName = fileName;
          // 修改文件命名逻辑：直接保存为S2
          if (processedName.startsWith('S1')) {
            processedName = processedName.replace('S1', 'S2');
          } else if (!processedName.startsWith('S2')) {
            // 如果不是S1开头，添加S2前缀
            const ext = path.extname(processedName);
            const nameWithoutExt = processedName.replace(ext, '');
            processedName = `S2_${nameWithoutExt}${ext}`;
          }
          if (!processedName.endsWith('.mp4')) {
            processedName = `${processedName}.mp4`;
          }

          targetPath = path.join(downloadDir, processedName);
          // 先保存为Y1路径（后续会被处理后的S2文件替换）
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          await download.saveAs(targetPath);
          this.emit('log', {
            message: `原始文件下载完成，保存为Y1格式至${targetPath}`,
            type: 'success',
          });
        } else {
          const tempPath = path.join(tempFolder, fileName); // 临时UUID文件存入专用临时文件夹
          try {
            await download.saveAs(tempPath);
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch (err: any) {
            this.emit('log', {
              message: `处理临时UUID文件出错: ${err.message}，请手动删除。`,
              type: 'warning',
            });
            this.writeLog(
              `处理临时UUID文件出错: ${err.message}，请手动删除。`,
              'info'
            );
          }
        }
      }

      // 清理残留UUID文件（仅清理临时文件夹内的）
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const tempFiles = fs.readdirSync(tempFolder);
      for (const file of tempFiles) {
        const baseName = path.basename(file, path.extname(file));
        if (uuidRegex.test(baseName)) {
          const uuidFilePath = path.join(tempFolder, file);
          try {
            fs.unlinkSync(uuidFilePath);
          } catch (e) {
            this.emit('log', {
              message: `删除临时UUID文件失败: ${
                (e as Error).message
              }，请手动删除。`,
              type: 'warning',
            });
            this.writeLog(
              `删除临时UUID文件失败: ${(e as Error).message}，请手动删除。`,
              'info'
            );
          }
        }
      }

      // 验证最终文件
      if (
        !targetPath ||
        !fs.existsSync(targetPath) ||
        fs.statSync(targetPath).size === 0
      ) {
        this.emit('log', {
          message: '验证文件失败，尝试目录监控查找',
          type: 'warning',
        });
        const currentFiles = fs.readdirSync(downloadDir);
        for (const file of currentFiles) {
          if (!preDownloadFiles.has(file) && !file.endsWith('.crdownload')) {
            const possiblePath = path.join(downloadDir, file);
            let processedName = file;
            // 使用新的命名逻辑：下载时保存为Y1
            if (processedName.startsWith('S1')) {
              processedName = processedName.replace('S1', 'Y1');
            } else if (!processedName.startsWith('Y1')) {
              // 如果不是S1开头，添加Y1前缀
              const ext = path.extname(processedName);
              const nameWithoutExt = processedName.replace(ext, '');
              processedName = `Y1---${nameWithoutExt}${ext}`;
            }
            if (!processedName.endsWith('.mp4')) {
              processedName = `${processedName}.mp4`;
            }
            targetPath = path.join(downloadDir, processedName);

            if (fs.existsSync(possiblePath)) {
              fs.renameSync(possiblePath, targetPath);
              break;
            }
          }
        }
      }

      this.emit('log', {
        message: `触发成功的回调，文件路径: ${targetPath}`,
        type: 'info',
      });
      this.writeLog(
        `S2处理完成，触发成功的回调，文件路径: ${targetPath}`,
        'info'
      );

      // 清理原始文件
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          this.emit('log', {
            message: `已清理原始文件：${filePath}`,
            type: 'info',
          });
          this.writeLog(`已清理原始文件：${filePath}`, 'info');
        } catch (e) {
          this.emit('log', {
            message: `清理原始文件失败：${(e as Error).message}`,
            type: 'warning',
          });
          this.writeLog(`清理原始文件失败：${(e as Error).message}`, 'warning');
        }
      }

      setTimeout(() => {
        this.okCallback(targetPath);
      }, 2000);
      // 关闭标签页
      await page.close();

      return {
        success: true,
        message: `文件已成功处理并保存至: ${targetPath}，临时文件夹保留: ${tempFolder}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      this.emit('log', {
        message: `视频去水印出错: ${error.message}`,
        type: 'error',
      });
      this.writeLog(`S2操作失败：${error.message}`, 'error');
      if (page) await page.close().catch(() => {});
      return {
        success: false,
        message: `操作失败: ${error.message}`,
      };
    }
  }

  // 辅助方法：等待文件可读写
  private async waitForFileAvailable(
    filePath: string,
    maxRetries = 10,
    delay = 1000
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await fs.promises.access(
          filePath,
          fs.constants.R_OK | fs.constants.W_OK
        );
        const fd = await fs.promises.open(filePath, 'r+');
        await fd.close();
        return true;
      } catch {
        if (i === maxRetries - 1) break;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error(`文件无法访问或被锁定: ${filePath}`);
  }

  // 辅助方法：生成有效的音频变速滤镜
  private getValidAtempoFilters(speedRatio: number): string[] {
    const filters: string[] = [];
    let remaining = speedRatio;

    // 限制极值，避免计算异常
    remaining = Math.max(0.5, Math.min(10, remaining));

    while (remaining > 2) {
      filters.push('atempo=2.0');
      remaining /= 2;
    }

    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining *= 2;
    }

    // 确保不出现科学计数法
    filters.push(`atempo=${remaining.toFixed(6)}`);
    return filters;
  }

  /**
   * 使用FFmpeg处理视频，调整时长为400秒
   * @param filePath 视频文件路径
   * @param targetDir 目标目录
   * @returns 处理结果
   */
  public async processVideoWithFFmpeg(
    filePath: string
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    try {
      // 验证文件路径
      if (!filePath || !fs.existsSync(filePath)) {
        const errorMsg = filePath
          ? `文件不存在，请检查路径: ${filePath}`
          : '未提供有效的文件路径';
        throw new Error(errorMsg);
      }

      const actualTargetDir = path.dirname(filePath);

      // 确保目标目录存在
      fs.mkdirSync(actualTargetDir, { recursive: true });

      // 创建专用临时文件夹
      const tempFolder = path.join(actualTargetDir, 'ffmpeg_temp');
      fs.mkdirSync(tempFolder, { recursive: true });
      this.emit('log', {
        message: `创建临时文件夹: ${tempFolder}`,
        type: 'info',
      });

      this.emit('log', {
        message: `开始使用FFmpeg处理视频: ${filePath}`,
        type: 'info',
      });

      // 检查文件可用性（避免文件被锁定）
      await this.waitForFileAvailable(filePath);

      // 获取视频的实际时长
      const ffmpegUtil = FFmpegUtil.getInstance();
      const videoDuration = await ffmpegUtil.getVideoDuration(filePath);

      // 计算变速比例，限制在0.5-10倍
      let speedRatio = videoDuration / 400;
      speedRatio = Math.max(0.5, Math.min(10, speedRatio));

      // 验证变速比例合法性
      if (isNaN(speedRatio) || speedRatio <= 0) {
        throw new Error(`无效的变速比例: ${speedRatio}`);
      }

      this.emit('log', {
        message: `原始视频时长: ${videoDuration.toFixed(
          2
        )}秒，目标时长: 400秒，变速比例: ${speedRatio.toFixed(2)}`,
        type: 'info',
      });

      // 在专用临时文件夹内创建临时输出文件
      const tempFileName = `temp_${Date.now()}.mp4`;
      let tempOutputPath = path.join(tempFolder, tempFileName);

      this.emit('log', {
        message: `FFmpeg临时输出路径: ${tempOutputPath}`,
        type: 'info',
      });

      // 处理音频变速参数
      const atempoFilters = this.getValidAtempoFilters(speedRatio);

      // 准备输出文件路径
      let targetPath: string | null = null;
      const originalFileName = path.basename(filePath);

      // 应用Y1/S2命名规则
      let processedName = originalFileName;
      if (processedName.startsWith('S1')) {
        processedName = processedName.replace('S1', 'Y1');
      } else if (!processedName.startsWith('Y1')) {
        // 如果不是S1开头，添加Y1前缀
        const ext = path.extname(processedName);
        const nameWithoutExt = processedName.replace(ext, '');
        processedName = `Y1_${nameWithoutExt}${ext}`;
      }
      if (!processedName.endsWith('.mp4')) {
        processedName = `${processedName}.mp4`;
      }

      // 先设置为Y1路径
      const y1Path = path.join(actualTargetDir, processedName);

      // 使用fluent-ffmpeg处理
      await new Promise<void>((resolve, reject) => {
        // 构建命令
        const command = ffmpeg(filePath).outputOptions([
          `-vf setpts=${(1 / speedRatio).toFixed(2)}*PTS`,
          '-f mp4',
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
          '-threads 0',
        ]);

        // 添加音频滤镜
        if (atempoFilters.length > 1) {
          command.outputOptions('-filter_complex', atempoFilters.join(','));
        } else {
          command.outputOptions('-af', atempoFilters[0]);
        }

        // 直接使用路径，fluent-ffmpeg会自动处理特殊字符
        command
          .output(tempOutputPath)
          .on('end', async () => {
            try {
              // 删除Y1文件（如果存在）
              if (fs.existsSync(y1Path)) {
                fs.unlinkSync(y1Path);
                this.emit('log', {
                  message: `已删除原Y1文件: ${y1Path}`,
                  type: 'info',
                });
              }

              // 创建S2文件名（将Y1改为S2）
              const s2FileName = processedName.replace(/^Y1/, 'S2');
              const s2Path = path.join(actualTargetDir, s2FileName);

              // 将处理后的临时文件重命名为S2文件
              await fs.promises.rename(tempOutputPath, s2Path);

              // 更新targetPath为S2文件路径
              targetPath = s2Path;

              this.emit('log', {
                message: `视频处理完成，已保存为S2格式至: ${targetPath}`,
                type: 'success',
              });
              resolve();
            } catch (err) {
              reject(new Error(`文件重命名失败: ${(err as Error).message}`));
            }
          })
          .on('error', err => {
            this.emit('log', {
              message: `FFmpeg处理错误: ${err.message}`,
              type: 'error',
            });
            // 清理临时文件
            if (fs.existsSync(tempOutputPath)) {
              fs.unlinkSync(tempOutputPath);
            }
            reject(new Error(`FFmpeg变速处理失败: ${err.message}`));
          })
          .run();
      });

      // 验证处理后的视频
      if (!targetPath) {
        throw new Error('targetPath 尚未赋值，无法获取视频时长');
      }
      const processedDuration = await ffmpegUtil.getVideoDuration(targetPath);
      this.emit('log', {
        message: `视频时长调整完成，处理后时长: ${processedDuration.toFixed(
          2
        )}秒`,
        type: 'success',
      });

      return {
        success: true,
        message: `文件已成功处理并保存至: ${targetPath}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      this.emit('log', {
        message: `FFmpeg视频处理出错: ${error.message}`,
        type: 'error',
      });
      return {
        success: false,
        message: `操作失败: ${error.message}`,
      };
    }
  }

  // 关闭浏览器实例的静态方法，可在应用退出时调用
  public static async closeBrowser() {
    if (PlaywrightScript.browser) {
      try {
        await PlaywrightScript.browser.close();
        // 明确设置状态为未就绪，确保下次调用时会重新初始化
        PlaywrightScript.browser = null;
        PlaywrightScript.isBrowserReady = false;
        console.log('浏览器实例已关闭');
      } catch (error) {
        console.error('关闭浏览器时出错:', error);
        // 即使关闭出错，也将状态设置为未就绪，以避免后续使用已损坏的实例
        PlaywrightScript.browser = null;
        PlaywrightScript.isBrowserReady = false;
      }
    }
  }
  /**
   * 视频质量修复处理
   * 处理完成后将S6文件复制到逛逛和京东分发目录各一份
   * 当下载目录清空后自动删除目录
   */
  public async RunVideoQualityFix(filePath: string, targetDir?: string) {
    let page: any = null;
    try {
      const downloadDir = targetDir
        ? path.resolve(targetDir)
        : path.dirname(filePath);
      fs.mkdirSync(downloadDir, { recursive: true });

      // 验证文件并提取原始文件名
      if (!filePath || !fs.existsSync(filePath)) {
        const errorMsg = filePath
          ? `文件不存在: ${filePath}`
          : '未提供文件路径';
        throw new Error(errorMsg);
      }
      const originalFileName = path.basename(filePath, path.extname(filePath));
      const targetFileName = originalFileName.startsWith('S5')
        ? `${originalFileName.replace('S5', 'S6')}.mp4`
        : `${originalFileName}.mp4`;
      const targetPath = path.join(downloadDir, targetFileName);

      this.emit('log', {
        message: `开始处理视频质量修复，目标文件: ${filePath}`,
        type: 'info',
      });
      this.writeLog(`开始处理视频质量修复，目标文件: ${filePath}`, 'info');

      // 初始化浏览器和页面
      await PlaywrightScript.initBrowser();
      if (!PlaywrightScript.browser) throw new Error('无法初始化浏览器');
      page = await PlaywrightScript.browser.newPage();
      await page.goto('https://www.kaipai.com/video-tool/quality');
      await page.waitForLoadState('networkidle');

      // 上传文件
      const uploadArea = await page.waitForSelector(
        '.UploadContentV2_cardRightBox__s8gmc',
        { timeout: 60000 }
      );
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        uploadArea.click(),
      ]);
      await fileChooser.setFiles(filePath);
      // this.emit('log', { message: `${filePath} 上传成功`, type: 'success' });

      // 选择分类
      await page.waitForSelector('.index_categorgList__dF7ji', {
        timeout: 60000,
      });
      await page.click(
        '.index_categorgList__dF7ji > .index_categoryItem__pPv2U:nth-child(3)'
      );

      // 点击开始处理
      await page.click('.index_button__WWpyb');
      this.writeLog(`${filePath} 上传成功，开始处理`, 'success');

      // 点击开始后等待20秒，避免网络延迟导致的状态误判
      await new Promise(resolve => setTimeout(resolve, 20000));

      // 全局超时和检测间隔设置
      const maxWaitTime = 15 * 60 * 1000; // 30分钟
      const checkInterval = 10 * 1000; // 10秒

      // 等待任务项DOM稳定
      await new Promise(resolve => setTimeout(resolve, 30000));

      // 等待导出按钮可用
      let exportButton: any = null;
      let retryClicked = false;
      let exportBtnStart = Date.now();
      while (Date.now() - exportBtnStart < maxWaitTime) {
        exportButton = await page
          .locator('.index_trackList__1mQ3P')
          .locator('.index_trackItem__vo4uQ')
          .first()
          .locator('.index_button__Zm8pL');

        if (exportButton) {
          const isVisible = await exportButton.isVisible();
          const isEnabled = await exportButton.isEnabled();

          if (isVisible && isEnabled) {
            // 获取按钮文本
            const buttonText = await exportButton.textContent();
            this.emit('log', {
              message: `检测到按钮: ${buttonText}`,
              type: 'info',
            });

            if (buttonText === '导出') {
              this.emit('log', {
                message: `导出按钮可见且可用，点击导出...`,
                type: 'info',
              });
              break;
            } else if (buttonText === '重试' && !retryClicked) {
              this.emit('log', {
                message: `检测到重试按钮，点击重试...`,
                type: 'info',
              });
              await exportButton.click();
              retryClicked = true;
              // 重新开始30分钟的超时等待
              exportBtnStart = Date.now();
              this.emit('log', {
                message: `已点击重试，重新开始等待导出按钮...`,
                type: 'info',
              });
              await new Promise(resolve => setTimeout(resolve, checkInterval));
              continue;
            } else {
              throw new Error(
                `按钮文本不是'导出'或'重试'，而是: ${buttonText}`
              );
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (
        !exportButton ||
        !(await exportButton.isVisible()) ||
        !(await exportButton.isEnabled())
      ) {
        throw new Error(`超过${maxWaitTime / 60000}分钟，导出按钮不可用`);
      }

      // 获取原始文件名
      const currentFileName = path.basename(filePath, path.extname(filePath));
      const isS5File = currentFileName.startsWith('S5');

      this.emit('log', {
        message: `将使用${isS5File ? 'S5开头' : '文件名'}进行匹配`,
        type: 'info',
      });

      // 点击导出按钮并设置自定义下载监听
      this.emit('log', {
        message: `导出按钮点击成功，等待下载完成...`,
        type: 'info',
      });

      // 监听下载事件
      let allDownloads: any[] = [];
      const handleDownload = (download: any) => {
        const downloadFileName = download.suggestedFilename();
        allDownloads.push(download);
        this.emit('log', {
          message: `检测到下载文件: ${downloadFileName}，文件路径将保存在: ${downloadDir}`,
          type: 'info',
        });
        // 特别标记S5开头的文件
        if (downloadFileName.startsWith('S5')) {
          this.emit('log', {
            message: `【重要】检测到S5开头的文件: ${downloadFileName}`,
            type: 'info',
          });
        }
      };

      page.on('download', handleDownload);

      // 等待下载事件 - 只处理S5开头的文件
      const downloadStart = Date.now();
      let targetDownload: any = null;

      try {
        await exportButton.click();

        while (Date.now() - downloadStart < maxWaitTime) {
          // 遍历所有下载，只查找S5开头的文件
          for (const download of allDownloads) {
            const downloadFileName = download.suggestedFilename();
            this.emit('log', {
              message: `当前检测到下载文件: ${downloadFileName}`,
              type: 'info',
            });

            // 只关注S5开头的文件，这是RunVideoQualityFix需要处理的文件
            if (downloadFileName.startsWith('S5')) {
              targetDownload = download;
              this.emit('log', {
                message: `找到匹配的S5文件: ${downloadFileName}`,
                type: 'success',
              });
              break;
            }
          }

          if (targetDownload) {
            break;
          }

          // 显示当前下载状态，方便调试
          if (allDownloads.length > 0 && Date.now() - downloadStart > 15000) {
            const downloadNames = allDownloads
              .map(d => d.suggestedFilename())
              .join(', ');
            this.emit('log', {
              message: `等待S5文件下载中... 已检测到${allDownloads.length}个下载文件: ${downloadNames}`,
              type: 'info',
            });
          }

          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
      } catch (err: any) {
        this.emit('log', {
          message: `下载触发过程出错: ${err.message}`,
          type: 'error',
        });
        page.off('download', handleDownload);
        return { success: false, message: `下载触发失败: ${err.message}` };
      }

      // 移除事件监听器
      page.off('download', handleDownload);

      // 如果没有找到目标S5下载，返回失败
      if (!targetDownload) {
        this.emit('log', {
          message: `未找到S5开头的下载文件，无法继续处理`,
          type: 'warning',
        });
        return { success: false, message: '未找到S5开头的下载文件' };
      } else {
        // 记录找到的下载文件信息
        const downloadFileName = targetDownload.suggestedFilename();
        this.writeLog(`监听到匹配的S5文件: ${downloadFileName}`, 'info');
        this.emit('log', {
          message: `监听到匹配的S5文件: ${downloadFileName}`,
          type: 'info',
        });
      }

      this.emit('log', { message: `下载完成，开始处理文件`, type: 'info' });

      // 保存下载的文件
      const downloadFileName = targetDownload.suggestedFilename();
      let tempPath = path.join(downloadDir, downloadFileName);
      await targetDownload.saveAs(tempPath);
      this.emit('log', {
        message: `保存下载文件到: ${tempPath}`,
        type: 'info',
      });

      // 等待文件写入完成
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 验证临时文件是否存在并且大小合理
      if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1024) {
        this.emit('log', {
          message: `临时文件不存在或过小: ${tempPath}`,
          type: 'error',
        });
        return { success: false, message: '下载文件无效' };
      }

      // 检查视频时长，如果小于5秒直接返回
      try {
        const ffmpegUtil = FFmpegUtil.getInstance();
        const duration = await ffmpegUtil.getVideoDuration(tempPath);
        this.emit('log', {
          message: `视频时长: ${duration.toFixed(2)}秒`,
          type: 'info',
        });

        if (duration < 5) {
          this.emit('log', {
            message: `视频时长小于5秒 (${duration.toFixed(2)}秒)，直接返回`,
            type: 'warning',
          });
          return { success: false, message: '视频时长过短' };
        }
      } catch (error) {
        this.emit('log', {
          message: `获取视频时长失败: ${(error as Error).message}`,
          type: 'error',
        });
        return { success: false, message: '获取视频时长失败' };
      }

      // 如果目标文件已存在，先删除旧文件
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
          this.emit('log', {
            message: `删除旧文件: ${targetPath}`,
            type: 'info',
          });
        } catch (error) {
          this.emit('log', {
            message: `删除旧文件失败: ${error}`,
            type: 'warning',
          });
        }
      }

      // 强制重命名文件
      try {
        fs.renameSync(tempPath, targetPath);
        this.emit('log', {
          message: `文件重命名完成: ${tempPath} -> ${targetPath}`,
          type: 'info',
        });
      } catch (error) {
        this.emit('log', {
          message: `文件重命名失败: ${error}`,
          type: 'error',
        });
        return { success: false, message: '文件重命名失败' };
      }

      // 验证重命名后的文件
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size < 1024) {
        this.emit('log', {
          message: `重命名后文件不存在或过小: ${targetPath}`,
          type: 'error',
        });
        return { success: false, message: '文件处理失败' };
      }

      // 调用FFmpegUtil进行高级视频处理
      this.emit('log', {
        message: `开始高级视频处理: ${targetPath}`,
        type: 'info',
      });

      try {
        const ffmpegUtil = FFmpegUtil.getInstance();

        // 创建临时输出路径，避免同目录输出冲突
        const tempOutputPath = path.join(downloadDir, `temp_${Date.now()}.mp4`);

        // 调用高级视频处理函数
        await ffmpegUtil.processAndRecodeVideo(targetPath, tempOutputPath);

        this.emit('log', {
          message: `高级视频处理完成: ${tempOutputPath}`,
          type: 'success',
        });

        // 验证处理后的文件
        if (
          !fs.existsSync(tempOutputPath) ||
          fs.statSync(tempOutputPath).size < 1024
        ) {
          this.emit('log', {
            message: `高级处理后的文件无效: ${tempOutputPath}`,
            type: 'error',
          });
          return { success: false, message: '高级视频处理失败' };
        }

        // 删除原始文件
        fs.unlinkSync(targetPath);

        // 将处理后的文件重命名为原始文件名
        fs.renameSync(tempOutputPath, targetPath);

        this.emit('log', {
          message: `已用处理后的视频替换原始文件: ${targetPath}`,
          type: 'success',
        });
      } catch (error) {
        this.emit('log', {
          message: `高级视频处理失败: ${(error as Error).message}`,
          type: 'error',
        });
        return {
          success: false,
          message: `高级视频处理失败: ${(error as Error).message}`,
        };
      }

      // 删除UUID格式的冗余文件（包括下载时的和目录中残留的）
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const files = fs.readdirSync(downloadDir);
      for (const file of files) {
        const baseName = path.basename(file, path.extname(file));
        if (uuidRegex.test(baseName)) {
          const uuidFilePath = path.join(downloadDir, file);
          try {
            fs.unlinkSync(uuidFilePath);
          } catch (e) {
            this.emit('log', {
              message: `删除UUID文件失败: ${(e as Error).message},请手动删除。`,
              type: 'warning',
            });
          }
        }
      }

      // 将S6文件复制到指定目录
      try {
        // 定义目标目录
        const targetDirs = [
          '\\\\192.168.31.99\\影视存储\\逛逛客户端\\视频分发\\逛逛',
          '\\\\192.168.31.99\\影视存储\\逛逛客户端\\视频分发\\京东',
        ];

        // 确保目标目录存在
        for (const targetDir of targetDirs) {
          if (!fs.existsSync(targetDir)) {
            try {
              fs.mkdirSync(targetDir, { recursive: true });
              this.emit('log', {
                message: `创建目标目录: ${targetDir}`,
                type: 'info',
              });
            } catch (mkdirError) {
              this.emit('log', {
                message: `创建目标目录失败: ${targetDir}, ${
                  (mkdirError as Error).message
                }`,
                type: 'error',
              });
              continue;
            }
          }

          // 复制文件到目标目录
          const fileName = path.basename(targetPath);
          const destPath = path.join(targetDir, fileName);

          try {
            fs.copyFileSync(targetPath, destPath);
            this.emit('log', {
              message: `复制文件到 ${targetDir}: ${fileName}`,
              type: 'success',
            });
          } catch (copyError) {
            this.emit('log', {
              message: `复制文件失败: ${fileName} 到 ${targetDir}, ${
                (copyError as Error).message
              }`,
              type: 'error',
            });
          }
        }

        // 复制完成后，清理当前目录下的S6文件
        if (targetPath && fs.existsSync(targetPath)) {
          const fileName = path.basename(targetPath);
          const isS6File = fileName.startsWith('S6') || /^S6/i.test(fileName);

          if (isS6File) {
            try {
              fs.unlinkSync(targetPath);
              this.emit('log', {
                message: `已清理原始S6文件：${targetPath}`,
                type: 'info',
              });
            } catch (e) {
              this.emit('log', {
                message: `清理S6文件失败：${(e as Error).message}`,
                type: 'warning',
              });
            }
          } else {
            this.emit('log', {
              message: `文件 ${fileName} 不是S6文件，跳过清理`,
              type: 'info',
            });
          }
        }

        // 清理原始S5文件
        if (filePath && fs.existsSync(filePath)) {
          const originalFileName = path.basename(filePath);
          if (originalFileName.startsWith('S5')) {
            try {
              fs.unlinkSync(filePath);
              this.emit('log', {
                message: `已清理原始S5文件：${filePath}`,
                type: 'info',
              });
            } catch (e) {
              this.emit('log', {
                message: `清理S5文件失败：${(e as Error).message}`,
                type: 'warning',
              });
            }
          }
        }

        // 检查当前下载目录是否为空，如果为空则删除目录
        try {
          // 检查原始S5文件所在目录
          const originalFileDir = path.dirname(filePath);
          const remainingFiles = fs.readdirSync(originalFileDir);
          const nonSystemFiles = remainingFiles.filter(
            file => !file.startsWith('.') && file !== 'desktop.ini'
          );

          // 筛选出以S5或S6开头的有效文件
          const validFiles = nonSystemFiles.filter(
            file => file.startsWith('S5') || file.startsWith('S6')
          );

          if (validFiles.length === 0) {
            // 没有有效文件，删除目录和里面的所有文件
            fs.rmSync(originalFileDir, { recursive: true, force: true });
            this.emit('log', {
              message: `原始文件目录中没有S5/S6开头的文件，删除目录及所有文件：${originalFileDir}`,
              type: 'info',
            });
          } else {
            this.emit('log', {
              message: `原始文件目录中还有 ${validFiles.length} 个有效文件（S5/S6开头），保留目录：${originalFileDir}`,
              type: 'info',
            });
          }
        } catch (dirError) {
          this.emit('log', {
            message: `检查原始文件目录状态时出错：${
              (dirError as Error).message
            }`,
            type: 'warning',
          });
        }
      } catch (copyError) {
        this.emit('log', {
          message: `处理S6文件复制时出错：${(copyError as Error).message}`,
          type: 'error',
        });
      }

      // 关闭标签页
      await page.close();

      this.writeLog(
        `高清处理完成，文件已复制到分发目录：${targetPath}`,
        'success'
      );

      return {
        success: true,
        message: `处理完成，文件已复制到分发目录：${targetPath}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      this.emit('log', {
        message: `操作失败：${error.message}`,
        type: 'error',
      });
      this.writeLog(`S6操作失败：${error.message}`, 'error');
      if (page) await page.close().catch(() => {});
      return { success: false, message: error.message };
    }
  }

  /**
   * 通过指定页面检查登录状态
   */
  public async CheckKaipaiLoginStatus() {
    try {
      // 初始化浏览器实例
      await PlaywrightScript.initBrowser();

      if (!PlaywrightScript.browser) {
        throw new Error('无法初始化浏览器实例');
      }

      // 创建新标签页
      const page = await PlaywrightScript.browser.newPage();

      // 导航到目标URL并等待加载完成
      await page.goto('https://www.kaipai.com/home');
      await page.waitForLoadState('networkidle');

      // 检查是否存在登录标识元素
      const avatarSelector = '.index_accountAvatar__gOrHw';
      const elementCount = await page.locator(avatarSelector).count();
      let isLoggedIn = elementCount > 0;

      this.emit('log', {
        message: `开拍登录状态检测结果: ${isLoggedIn ? '已登录' : '未登录'}`,
        type: isLoggedIn ? 'success' : 'warning',
      });

      return {
        success: isLoggedIn,
        message: isLoggedIn
          ? '检测到用户已登录（发现账户头像元素）'
          : '未检测到用户登录状态（未发现账户头像元素）',
        isLoggedIn: isLoggedIn,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `登录状态检测失败: ${error.message}`,
        isLoggedIn: null,
      };
    }
  }

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}

export default PlaywrightScript;

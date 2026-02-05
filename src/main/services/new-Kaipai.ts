import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
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

      // 创建专用临时文件夹
      const tempFolder = path.join(downloadDir, 'ffmpeg_temp');
      fs.mkdirSync(tempFolder, { recursive: true });

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
      await page.goto('https://www.kaipai.com/video-watermark-remover/upload');
      await page.waitForLoadState('networkidle');

      // --- 1. 登录状态检测 ---
      this.emit('log', { message: '检测是否已登录', type: 'info' });
      const avatarContainer = '.header-account--cs5Lc';
      const loggedInIndicator = `${avatarContainer} span.ant-avatar-image`;

      const isLoggedIn = await page.locator(loggedInIndicator).isVisible();
      if (!isLoggedIn) {
        this.emit('log', { message: '未登录，触发登录操作', type: 'info' });
        const loginButton = await page.waitForSelector('.iconfont-legacy', {
          timeout: 10000,
        });
        await loginButton.click();

        await page.waitForSelector(loggedInIndicator, {
          timeout: 300000, // 5分钟登录超时
          state: 'visible',
        });
        this.emit('log', { message: '登录成功，继续处理', type: 'success' });
      } else {
        this.emit('log', { message: '已登录，继续处理', type: 'success' });
      }

      // --- 2. 上传文件 ---
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      const uploadBtnSelector =
        '.styleupload-btn-primary---lNVD, .styleupload-btn-primary--RH7Q5';
      const uploadButton = await page.waitForSelector(uploadBtnSelector, {
        state: 'visible',
        timeout: 30000,
      });

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        uploadButton.click(),
      ]);
      await fileChooser.setFiles(filePath);

      this.emit('log', { message: `文件已选择，开始上传`, type: 'success' });
      this.writeLog(`${filePath}上传成功，开始处理`, 'info');

      // --- 3. 等待处理完成 (轮询) ---
      // 固定等待2分钟缓冲区
      this.emit('log', { message: '等待2分钟让后台开始处理...', type: 'info' });
      await new Promise(resolve => setTimeout(resolve, 120 * 1000));

      const maxWaitTime = 60 * 60 * 1000; // 1小时
      const checkInterval = 20 * 1000;
      const exportBtnStart = Date.now();
      let targetExportButton = null;

      while (Date.now() - exportBtnStart < maxWaitTime) {
        const firstTaskCard = page
          .locator('.styletask-card-list--mBS0X .styletask-card--Y5yrO')
          .first();
        const buttonSection = firstTaskCard.locator(
          '.stylebutton-section--iTDR6'
        );

        // 1个按钮=处理中，2个按钮=处理完成
        const buttonCount = await buttonSection.locator('button').count();

        if (buttonCount >= 2) {
          const exportBtn = firstTaskCard.locator(
            'button.stylepremium-button--TMvm2'
          );
          if ((await exportBtn.isVisible()) && (await exportBtn.isEnabled())) {
            this.emit('log', {
              message: '检测到任务处理完成，导出按钮已就绪',
              type: 'success',
            });
            targetExportButton = exportBtn;
            break;
          }
        }
        console.log(
          `[${new Date().toLocaleTimeString()}] 处理中 (按钮数: ${buttonCount})...`
        );
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!targetExportButton) {
        throw new Error(`导出按钮轮询超时`);
      }

      // --- 4. 触发下载与更名处理 ---
      const originalFileName = path.basename(filePath, path.extname(filePath));
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let finalSavePath = '';

      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30 * 60 * 1000 }),
          targetExportButton.click(),
        ]);

        const suggestedName = download.suggestedFilename();
        const baseSuggestedName = path.basename(
          suggestedName,
          path.extname(suggestedName)
        );

        let processedName = '';

        // 如果是 UUID 命名的临时文件，使用原始文件名重命名
        if (uuidRegex.test(baseSuggestedName)) {
          processedName = `S2_${originalFileName}.mp4`;
        } else {
          // 普通文件名处理逻辑
          processedName = suggestedName;
          if (processedName.startsWith('S1')) {
            processedName = processedName.replace('S1', 'S2');
          } else if (!processedName.startsWith('S2')) {
            processedName = `S2_${processedName}`;
          }
          if (!processedName.endsWith('.mp4')) processedName += '.mp4';
        }

        finalSavePath = path.join(downloadDir, processedName);

        // 如果已存在同名文件则先删除
        if (fs.existsSync(finalSavePath)) {
          fs.unlinkSync(finalSavePath);
        }

        this.emit('log', {
          message: `正在捕获并保存为: ${processedName}`,
          type: 'info',
        });
        await download.saveAs(finalSavePath);

        this.emit('log', {
          message: `文件处理成功: ${processedName}`,
          type: 'success',
        });
        this.writeLog(`S2处理成功: ${finalSavePath}`, 'info');

        // 成功回调
        setTimeout(() => {
          this.okCallback(finalSavePath);
        }, 2000);
      } catch (err: any) {
        throw new Error(`下载处理失败: ${err.message}`);
      }

      // --- 5. 清理原始文件 ---
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          this.emit('log', {
            message: `已清理原始文件：${filePath}`,
            type: 'info',
          });
        } catch (e) {
          console.warn('清理原始文件失败');
        }
      }

      // 关闭标签页
      await page.close();

      return {
        success: true,
        message: '处理完成',
        filePath: finalSavePath,
      };
    } catch (error: any) {
      this.emit('log', {
        message: `视频去水印出错: ${error.message}`,
        type: 'error',
      });
      this.writeLog(`S2操作失败：${error.message}`, 'error');
      if (page) await page.close().catch(() => {});
      return { success: false, message: `操作失败: ${error.message}` };
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
   * 视频质量修复处理 (优化版)
   * 流程：上传 -> 选超清 -> 开始处理 -> 轮询下载 -> S5转S6 -> 分发 -> 清理
   */
  public async RunVideoQualityFix(filePath: string, targetDir?: string) {
    let page: any = null;
    try {
      const downloadDir = targetDir
        ? path.resolve(targetDir)
        : path.dirname(filePath);
      fs.mkdirSync(downloadDir, { recursive: true });

      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      const originalFileName = path.basename(filePath, path.extname(filePath));
      // 预设目标文件名（S5 -> S6）
      const targetFileName = originalFileName.startsWith('S5')
        ? `${originalFileName.replace('S5', 'S6')}.mp4`
        : `S6_${originalFileName}.mp4`;
      const targetPath = path.join(downloadDir, targetFileName);

      this.emit('log', {
        message: `开始处理视频质量修复: ${filePath}`,
        type: 'info',
      });

      // 初始化
      await PlaywrightScript.initBrowser();
      if (!PlaywrightScript.browser) throw new Error('无法初始化浏览器');
      page = await PlaywrightScript.browser.newPage();
      await page.goto('https://www.kaipai.com/video-enhancer/upload');
      await page.waitForLoadState('networkidle');

      // --- 1. 上传文件 ---
      const uploadBtnSelector =
        '.styleupload-btn-primary---lNVD, .styleupload-btn-primary--RH7Q5';
      const uploadButton = await page.waitForSelector(uploadBtnSelector, {
        state: 'visible',
      });

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        uploadButton.click(),
      ]);
      await fileChooser.setFiles(filePath);

      this.emit('log', {
        message: '上传成功，等待加载配置...',
        type: 'success',
      });
      await new Promise(resolve => setTimeout(resolve, 10000)); // 上传后等10秒

      // --- 2. 选择“超清”模式并点击开始 ---
      try {
        const firstCard = page
          .locator('.styletask-card-list--mBS0X .styletask-card--Y5yrO')
          .first();

        // 1. 定位配置区域的 ul (styleradio--d7vMt) 并选择其下第二个 li (超清)
        const superClearTab = firstCard
          .locator('ul.styleradio--d7vMt li')
          .nth(1); // nth(1) 是第二个元素

        await superClearTab.click();
        this.emit('log', { message: '已点击选择“超清”模式', type: 'info' });

        // 2. 点击“开始处理”按钮
        const startBtn = firstCard.locator(
          'button.styleprocessing-button--3-Ysv'
        );

        // 确保按钮加载并可点击
        await startBtn.waitFor({ state: 'visible', timeout: 5000 });
        await startBtn.click();

        this.emit('log', {
          message: '已点击开始处理，进入1分钟等待期...',
          type: 'info',
        });
      } catch (e: any) {
        throw new Error(`配置超清模式或点击开始失败: ${e.message}`);
      }

      // --- 3. 轮询等待处理完成 ---
      await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 点击后等1分钟

      const maxWaitTime = 20 * 60 * 1000; // 调高至20分钟
      const checkInterval = 15 * 1000;
      const startTime = Date.now();
      let exportButton: any = null;

      while (Date.now() - startTime < maxWaitTime) {
        // 重新定位第一个卡片
        const firstCard = page
          .locator('.styletask-card-list--mBS0X .styletask-card--Y5yrO')
          .first();

        // 1. 定位导出按钮（类名：stylepremium-button--TMvm2）
        const btn = firstCard.locator('button.stylepremium-button--TMvm2');

        // 2. 只要按钮可见且已启用（Enabled 表示处理完成，不再是 loading 状态），即认为可以点击
        if ((await btn.isVisible()) && (await btn.isEnabled())) {
          this.emit('log', {
            message: '检测到任务处理完成（导出按钮已就绪）',
            type: 'success',
          });
          exportButton = btn;
          break;
        }

        console.log(
          `[${new Date().toLocaleTimeString()}] 任务处理中，等待导出按钮可用...`
        );
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!exportButton) throw new Error('处理超时，未见导出按钮');

      // --- 4. 下载流处理 (核心优化) ---
      this.emit('log', { message: '正在触发下载...', type: 'info' });
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10 * 60 * 1000 }),
        exportButton.click(),
      ]);

      const tempDownloadPath = path.join(
        downloadDir,
        `temp_${Date.now()}_${download.suggestedFilename()}`
      );
      await download.saveAs(tempDownloadPath);

      // --- 5. 视频验证与 FFmpeg 处理 ---
      const ffmpegUtil = FFmpegUtil.getInstance();
      const duration = await ffmpegUtil.getVideoDuration(tempDownloadPath);
      if (duration < 5) {
        fs.unlinkSync(tempDownloadPath);
        return { success: false, message: '视频时长过短' };
      }

      // 执行高级修复（转码等）
      const processedTempPath = path.join(
        downloadDir,
        `processed_${Date.now()}.mp4`
      );
      await ffmpegUtil.processAndRecodeVideo(
        tempDownloadPath,
        processedTempPath
      );

      // 落地最终 S6 文件
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      fs.renameSync(processedTempPath, targetPath);
      if (fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath);

      this.emit('log', {
        message: `S6 文件已就绪: ${targetFileName}`,
        type: 'success',
      });

      // --- 6. 分发文件 ---
      const distributionDirs = [
        '\\\\192.168.31.99\\影视存储\\逛逛客户端\\视频分发\\逛逛',
        '\\\\192.168.31.99\\影视存储\\逛逛客户端\\视频分发\\京东',
      ];

      for (const dist of distributionDirs) {
        try {
          if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });
          const destFile = path.join(dist, targetFileName);
          fs.copyFileSync(targetPath, destFile);
          this.emit('log', {
            message: `已分发至: ${path.basename(dist)}`,
            type: 'info',
          });
        } catch (e) {
          this.emit('log', { message: `分发失败: ${dist}`, type: 'warning' });
        }
      }

      // --- 7. 清理工作 ---
      // 1. 清理本地 S6
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      // 2. 清理原始 S5
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      // 3. 如果目录空了，删除目录
      const originalDir = path.dirname(filePath);
      const remaining = fs
        .readdirSync(originalDir)
        .filter(f => !f.startsWith('.') && f !== 'desktop.ini');
      if (remaining.length === 0) {
        fs.rmSync(originalDir, { recursive: true, force: true });
        this.emit('log', {
          message: `目录已清空，自动移除: ${originalDir}`,
          type: 'info',
        });
      }

      await page.close();
      return { success: true, message: '处理并分发完成', filePath: targetPath };
    } catch (error: any) {
      this.emit('log', {
        message: `质量修复失败: ${error.message}`,
        type: 'error',
      });
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
      await page.goto('https://www.kaipai.com/workspace');
      // 建议增加一个适当的等待，确保动态内容加载
      await page.waitForLoadState('networkidle');

      /**
       * 检查容器 .header-account--cs5Lc 下是否存在具备 .ant-avatar-image 类的 span
       */
      const avatarSpanSelector = '.header-account--cs5Lc span.ant-avatar-image';
      const avatarElement = page.locator(avatarSpanSelector);

      const isLoggedIn = await avatarElement.isVisible();

      this.emit('log', {
        message: `开拍登录状态检测结果: ${isLoggedIn ? '已登录' : '未登录'}`,
        type: isLoggedIn ? 'success' : 'warning',
      });

      return {
        success: true,
        message: isLoggedIn
          ? '检测到用户已登录（发现已激活的头像组件）'
          : '未检测到用户登录状态（头像组件未处于登录态）',
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

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

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
  private static async initBrowser(downloadDir: string) {
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
              downloadsPath: downloadDir,
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

  public async runWatermarkRemoval(filePath?: string, targetDir?: string) {
    let page: any = null;
    try {
      // 确定下载目录
      const defaultDownloadDir = path.join(
        os.homedir(),
        'Downloads',
        'kaipai_output'
      );
      const downloadDir = targetDir
        ? path.resolve(targetDir)
        : defaultDownloadDir;

      // 确保下载目录存在
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      this.emit('log', { message: '开始处理视频去水印', type: 'info' });

      // 初始化浏览器实例
      await PlaywrightScript.initBrowser(downloadDir);

      if (!PlaywrightScript.browser) {
        throw new Error('无法初始化浏览器实例');
      }

      // 创建新标签页
      page = await PlaywrightScript.browser.newPage();

      // 打开网页并等待加载
      await page.goto('https://www.kaipai.com/video-tool/remove-watermark');
      await page.waitForLoadState('networkidle');

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
        {
          timeout: 30000,
        }
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

      const secondCategorySelector =
        '.index_categorgList__dF7ji > .index_categoryItem__pPv2U:nth-child(1)';

      const secondCategory = await page.waitForSelector(
        secondCategorySelector,
        {
          timeout: 30000,
        }
      );
      await secondCategory.click();

      // 开始处理
      const startBtnSelector = '.index_button__WWpyb';
      const startButton = await page.waitForSelector(startBtnSelector, {
        timeout: 30000,
      });
      await startButton.click();

      // 处理登录
      const loginPopupSelector = '.meitu-account-quick-login-popup-container';
      try {
        await page.waitForSelector(loginPopupSelector, {
          state: 'visible',
          timeout: 5000,
        });
        await page.waitForSelector(loginPopupSelector, {
          state: 'hidden',
          timeout: 120000,
        });
      } catch (error) {
        // 未检测到登录弹窗，继续执行
      }
      this.emit('log', { message: `${filePath}处理开始`, type: 'info' });

      // 等待处理完成
      const exportButtonSelector =
        '.index_buttonBox__-1roP .index_exportButton__4OdAj';
      const maxWaitTime = 120 * 60 * 1000; // 最大等待时间（2小时）
      const checkInterval = 60 * 1000; // 检查间隔（1分钟）

      try {
        await page.waitForFunction(
          (selector: any) => {
            const btn = document.querySelector(selector);
            return btn && !btn.classList.contains('index_disabled__Xu0Xz');
          },
          exportButtonSelector,
          {
            timeout: maxWaitTime,
            polling: checkInterval,
          }
        );
      } catch (error) {
        return {
          success: false,
          message: `超过最大等待时间(${
            maxWaitTime / 60000
          }分钟)，导出按钮仍不可用`,
        };
      }

      // 监听下载事件
      const downloads: any = [];
      const downloadPromise = new Promise(resolve => {
        const listener = (download: any) => {
          downloads.push(download);
          // 等待5秒确认是否有更多文件
          setTimeout(() => {
            page.off('download', listener);
            resolve(downloads);
          }, 5000);
        };
        page.on('download', listener);
        page.click(exportButtonSelector);
      });

      const allDownloads: any = await downloadPromise;

      if (allDownloads.length === 0) {
        return { success: false, message: '未捕获到任何下载文件' };
      }

      // 处理下载的文件（S2→S3）
      let targetPath = null;
      const uuidPattern =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

      for (const download of allDownloads) {
        const downloadPath = await download.path();
        if (!downloadPath) continue;

        const fileName = download.suggestedFilename();
        const isUuidFile = uuidPattern.test(fileName);

        if (!isUuidFile) {
          let processedName = fileName;
          // 文件名替换：S2→S3
          if (processedName.startsWith('S2')) {
            processedName = processedName.replace('S2', 'S3');
          }

          if (!processedName.endsWith('.mp4')) {
            processedName = `${processedName}.mp4`;
          }

          targetPath = path.join(downloadDir, processedName);
          // 若目标文件已存在，先删除
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          await download.saveAs(targetPath);
          this.emit('log', { message: `${filePath}下载完成`, type: 'success' });
        } else {
          // 处理临时UUID文件
          const tempPath = path.join(downloadDir, fileName);
          await download.saveAs(tempPath);
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        }
      }

      if (!targetPath) {
        return { success: false, message: '未找到有效的下载文件' };
      }

      // 下载完成后修改原文件所在文件夹名（S2→S3）
      const originalFileDir = path.dirname(filePath);
      const originalDirName = path.basename(originalFileDir);
      if (originalDirName.includes('S2')) {
        const newDirName = originalDirName.replace('S2', 'S3');
        const newFileDir = path.join(path.dirname(originalFileDir), newDirName);
        const renameSuccess = await this.renameWithRetry(
          originalFileDir,
          newFileDir
        );
        if (renameSuccess) {
          this.emit('log', {
            message: `文件夹重命名成功: ${originalFileDir} → ${newFileDir}`,
            type: 'success',
          });
        } else {
          this.emit('log', {
            message: `文件夹重命名失败（可能被占用）: ${originalFileDir}`,
            type: 'warning',
          });
        }
      }

      this.okCallback(targetPath);
      return {
        success: true,
        message: `文件已成功处理并保存至: ${targetPath}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      console.error('视频去水印出错:', error.message);
      this.emit('log', {
        message: `视频去水印出错: ${error.message}`,
        type: 'error',
      });
      return {
        success: false,
        message: `操作失败: ${error.message}`,
      };
    } finally {
      // 关闭标签页，保留浏览器实例
      if (page && !page.isClosed()) {
        await page.close().catch((err: any) => {
          console.error('关闭标签页失败:', err.message);
        });
      }
      console.log('视频去水印流程结束');
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
   */
  public async RunVideoQualityFix(filePath?: string, targetDir?: string) {
    let page;
    try {
      // 获取当前系统用户名
      const username = os.userInfo().username;

      // 确定下载目录
      const defaultDownloadDir = path.join(
        os.homedir(),
        'Downloads',
        'kaipai_output'
      );
      const downloadDir = targetDir
        ? path.resolve(targetDir)
        : defaultDownloadDir;

      this.emit('log', { message: '开始处理视频去水印', type: 'info' });

      // 确保下载目录存在
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      // 初始化浏览器实例 - 即使之前已关闭也会重新创建
      await PlaywrightScript.initBrowser(downloadDir);

      if (!PlaywrightScript.browser) {
        throw new Error('无法初始化浏览器实例');
      }

      // 创建新标签页
      const page = await PlaywrightScript.browser.newPage();

      // 打开网页并等待加载
      await page.goto('https://www.kaipai.com/video-tool/quality');
      await page.waitForLoadState('networkidle');

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
        {
          timeout: 30000,
        }
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

      const secondCategorySelector =
        '.index_categorgList__dF7ji > .index_categoryItem__pPv2U:nth-child(3)';

      const secondCategory = await page.waitForSelector(
        secondCategorySelector,
        {
          timeout: 30000,
        }
      );
      await secondCategory.click();

      // 开始处理
      const startBtnSelector = '.index_button__WWpyb';
      const startButton = await page.waitForSelector(startBtnSelector, {
        timeout: 30000,
      });
      // await startButton.click();

      // 处理登录
      const loginPopupSelector = '.meitu-account-quick-login-popup-container';

      try {
        await page.waitForSelector(loginPopupSelector, {
          state: 'visible',
          timeout: 5000,
        });

        await page.waitForSelector(loginPopupSelector, {
          state: 'hidden',
          timeout: 120000,
        });
      } catch (error) {
        // 未检测到登录弹窗，继续执行
      }
      this.emit('log', { message: `${filePath}处理开始`, type: 'info' });

      // 等待处理完成（修正后的轮询逻辑，解决类型报错）
      const exportButtonSelector =
        '.index_buttonBox__-1roP .index_exportButton__4OdAj';
      const maxWaitTime = 120 * 60 * 1000; // 最大等待时间（2小时）
      const checkInterval = 60 * 1000; // 检查间隔（1分钟）

      try {
        await page.waitForFunction(
          (selector: any) => {
            const btn = document.querySelector(selector);
            return btn && !btn.classList.contains('index_disabled__Xu0Xz');
          },
          exportButtonSelector,
          {
            timeout: maxWaitTime,
            polling: checkInterval,
          }
        );
      } catch (error) {
        return {
          success: false,
          message: `超过最大等待时间(${
            maxWaitTime / 60000
          }分钟)，导出按钮仍不可用`,
        };
      }

      // 监听下载事件
      const downloads: any = [];
      const downloadPromise = new Promise(resolve => {
        const listener = (download: any) => {
          downloads.push(download);
          // 等待5秒确认是否有更多文件
          setTimeout(() => {
            page.off('download', listener);
            resolve(downloads);
          }, 5000);
        };

        page.on('download', listener);
        page.click(exportButtonSelector);
      });

      const allDownloads: any = await downloadPromise;

      if (allDownloads.length === 0) {
        return { success: false, message: '未捕获到任何下载文件' };
      }

      // 处理下载的文件
      let targetPath = null;
      const uuidPattern =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

      for (const download of allDownloads) {
        const downloadPath = await download.path();
        if (!downloadPath) continue;

        const fileName = download.suggestedFilename();
        const isUuidFile = uuidPattern.test(fileName);

        if (!isUuidFile) {
          let processedName = fileName;
          if (processedName.startsWith('S5')) {
            processedName = processedName.replace('S5', 'S6');
          }

          if (!processedName.endsWith('.mp4')) {
            processedName = `${processedName}.mp4`;
          }

          targetPath = path.join(downloadDir, processedName);
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          await download.saveAs(targetPath);
          this.emit('log', { message: `${filePath}处理完成`, type: 'success' });
        } else {
          const tempPath = path.join(downloadDir, fileName);
          await download.saveAs(tempPath);
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            this.emit('log', {
              message: `${filePath}处理完成`,
              type: 'success',
            });
          }
        }
      }

      if (!targetPath) {
        return { success: false, message: '未找到有效的下载文件' };
      }

      // 不关闭浏览器，保持实例运行
      return {
        success: true,
        message: `文件已成功处理并保存至: ${targetPath}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      console.error('操作过程中出现错误:', error.message);
      this.emit('log', {
        message: `操作过程中出现错误: ${error.message}`,
        type: 'error',
      });
    } finally {
      console.log('操作完成');
    }
  }

  private async renameWithRetry(
    oldPath: string,
    newPath: string,
    maxRetries = 5,
    delay = 1000
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        // 检查原路径是否存在
        if (!fs.existsSync(oldPath)) {
          console.log(`原路径不存在，跳过重命名: ${oldPath}`);
          return false;
        }

        // 若新路径已存在，先删除（避免重命名冲突）
        if (fs.existsSync(newPath)) {
          try {
            fs.rmdirSync(newPath, { recursive: true });
            console.log(`已删除已存在的目标路径: ${newPath}`);
          } catch (rmErr: any) {
            console.warn(
              `删除目标路径失败，将尝试直接重命名: ${rmErr.message}`
            );
          }
        }

        // 执行重命名
        fs.renameSync(oldPath, newPath);
        return true;
      } catch (err: any) {
        // 非权限错误直接返回失败
        if (err.code !== 'EPERM' && err.code !== 'EBUSY') {
          console.error(`重命名失败（非占用错误）: ${err.message}`);
          return false;
        }

        // 最后一次重试失败
        if (i === maxRetries - 1) {
          console.error(
            `达到最大重试次数(${maxRetries})，重命名失败: ${err.message}`
          );
          return false;
        }

        // 延迟后重试
        console.log(`因文件占用，将在${delay}ms后进行第${i + 2}次重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  /**
   * 通过指定页面检查登录状态
   */
  public async CheckKaipaiLoginStatus() {
    let isLoggedIn = false;
    let page: any;
    try {
      // 获取当前系统用户名
      const username = os.userInfo().username;

      // 确定下载目录
      const defaultDownloadDir = path.join(
        os.homedir(),
        'Downloads',
        'kaipai_output'
      );

      // 初始化浏览器实例 - 即使之前已关闭也会重新创建
      await PlaywrightScript.initBrowser(defaultDownloadDir);

      if (!PlaywrightScript.browser) {
        throw new Error('无法初始化浏览器实例');
      }

      // 创建新标签页
      const page = await PlaywrightScript.browser.newPage();

      // 导航到目标URL
      // console.log(`正在访问页面: https://www.kaipai.com/home`);
      await page.goto('https://www.kaipai.com/home');
      await page.waitForLoadState('networkidle');
      // console.log('页面加载完成');

      // 检查是否存在登录标识元素
      // console.log('开始检测登录状态...');
      const avatarSelector = '.index_accountAvatar__gOrHw';
      const elementCount = await page.locator(avatarSelector).count();
      const isLoggedIn = elementCount > 0;

      // console.log(`登录状态检测结果: ${isLoggedIn ? '已登录' : '未登录'}`);

      // 不关闭浏览器，保持实例运行
      this.emit('log', {
        message: `开拍登录状态检测结果: ${isLoggedIn ? '已登录' : '未登录'}`,
        type: 'info',
      });

      return {
        success: isLoggedIn,
        message: isLoggedIn
          ? '检测到用户已登录（发现账户头像元素）'
          : '未检测到用户登录状态（未发现账户头像元素）',
        isLoggedIn: isLoggedIn, // 明确返回登录状态
      };
    } catch (error: any) {
      // console.error('登录状态检测过程中出现错误:', error.message);

      return {
        success: false,
        message: `登录状态检测失败: ${error.message}`,
        isLoggedIn: null, // 错误情况下登录状态为null
      };
    } finally {
      // 关闭当前标签页，但保留浏览器实例
      if (page && !page.isClosed()) {
        await page.close().catch((error: any) => {
          console.error('关闭标签页时出错:', error);
        });
      }
      console.log('登录状态检查完成，标签页已关闭');
    }
  }
}

export default PlaywrightScript;

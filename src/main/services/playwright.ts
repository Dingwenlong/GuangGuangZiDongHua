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

      fs.mkdirSync(downloadDir, { recursive: true });

      this.emit('log', { message: '开始处理视频去水印', type: 'info' });

      // 初始化浏览器实例
      await PlaywrightScript.initBrowser(downloadDir);
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
        { timeout: 30000 }
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

      // 点击开始后等待10秒
      await new Promise(resolve => setTimeout(resolve, 10 * 1000));

      // 全局超时和检测间隔设置
      const maxWaitTime = 120 * 60 * 1000; // 2小时
      const checkInterval = 30 * 1000; // 30秒

      // 等待处理列表出现
      const trackListSelector = '.index_trackList__1mQ3P';
      let trackListFound = false;
      const trackListStart = Date.now();
      while (Date.now() - trackListStart < maxWaitTime) {
        const trackList = await page.$(trackListSelector);
        if (trackList) {
          trackListFound = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      if (!trackListFound) {
        throw new Error(`超过${maxWaitTime / 60000}分钟未找到处理列表`);
      }

      // 等待第一个处理项出现
      const trackItemSelector = '.index_trackItem__vo4uQ';
      let firstItemFound = false;
      const firstItemStart = Date.now();
      while (Date.now() - firstItemStart < maxWaitTime) {
        const firstItem = await page.$(
          `${trackListSelector} ${trackItemSelector}:first-child`
        );
        if (firstItem) {
          firstItemFound = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      if (!firstItemFound) {
        throw new Error(`超过${maxWaitTime / 60000}分钟未找到处理项`);
      }

      // 等待导出按钮可用
      const exportButtonSelector = '.index_button__Zm8pL';
      let exportButton: any = null;
      const exportBtnStart = Date.now();
      while (Date.now() - exportBtnStart < maxWaitTime) {
        exportButton = await page.$(
          `${trackListSelector} ${trackItemSelector}:first-child ${exportButtonSelector}`
        );

        if (exportButton) {
          const isVisible = await exportButton.isVisible();
          const isEnabled = await exportButton.isEnabled();
          if (isVisible && isEnabled) {
            break;
          }
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (
        !exportButton ||
        !(await exportButton.isVisible()) ||
        !(await exportButton.isEnabled())
      ) {
        throw new Error(`超过${maxWaitTime / 60000}分钟，导出按钮仍不可用`);
      }

      // 监听下载事件
      let allDownloads: any[] = [];
      const handleDownload = (download: any) => {
        allDownloads.push(download);
        this.emit('log', {
          message: `检测到下载文件: ${download.suggestedFilename()}`,
          type: 'info',
        });
      };

      page.on('download', handleDownload);

      try {
        // 点击导出按钮
        await exportButton.waitForElementState('enabled', {
          timeout: maxWaitTime,
        });
        this.emit('log', { message: '尝试点击导出按钮', type: 'info' });
        await exportButton.click();

        // 等待下载事件
        const downloadStart = Date.now();
        let downloadEvent: any = null;
        while (Date.now() - downloadStart < maxWaitTime) {
          if (allDownloads.length > 0) {
            downloadEvent = allDownloads[0];
            break;
          }
          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        if (!downloadEvent) {
          // 尝试键盘操作
          this.emit('log', { message: '尝试键盘操作触发下载', type: 'info' });
          await exportButton.focus();
          await page.keyboard.press('Enter');

          // 再次等待下载
          const keyboardDownloadStart = Date.now();
          while (Date.now() - keyboardDownloadStart < maxWaitTime) {
            if (allDownloads.length > 0) {
              downloadEvent = allDownloads[0];
              break;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
          }
        }

        if (!downloadEvent) {
          throw new Error(`超过${maxWaitTime / 60000}分钟未检测到下载事件`);
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (err: any) {
        this.emit('log', {
          message: `下载触发过程出错: ${err.message}`,
          type: 'error',
        });
        page.off('download', handleDownload);
        if (page) await page.close().catch(() => {});
        return { success: false, message: `下载触发失败: ${err.message}` };
      } finally {
        page.off('download', handleDownload);
      }

      if (allDownloads.length === 0) {
        this.emit('log', { message: '未捕获到任何下载文件', type: 'warning' });
        if (page) await page.close().catch(() => {});
        return { success: false, message: '未捕获到任何下载文件' };
      }

      // 处理下载文件（S1改为S2）
      let targetPath = null;
      const uuidPattern =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      const preDownloadFiles = new Set(fs.readdirSync(downloadDir));

      for (const download of allDownloads) {
        const fileName = download.suggestedFilename();
        const isUuidFile = uuidPattern.test(fileName);

        if (!isUuidFile) {
          let processedName = fileName;
          if (processedName.startsWith('S1')) {
            processedName = processedName.replace('S1', 'S2');
          }
          if (!processedName.endsWith('.mp4')) {
            processedName = `${processedName}.mp4`;
          }

          targetPath = path.join(downloadDir, processedName);
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          await download.saveAs(targetPath);
          this.emit('log', {
            message: `文件下载完成，保存至${targetPath}`,
            type: 'success',
          });
        } else {
          const tempPath = path.join(downloadDir, fileName);
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
          }
        }
      }

      // 清理残留UUID文件
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
              message: `删除UUID文件失败: ${
                (e as Error).message
              }，请手动删除。`,
              type: 'warning',
            });
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
            if (processedName.startsWith('S1')) {
              processedName = processedName.replace('S1', 'S2');
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

      if (
        !targetPath ||
        !fs.existsSync(targetPath) ||
        fs.statSync(targetPath).size === 0
      ) {
        if (page) await page.close().catch(() => {});
        return { success: false, message: '未找到有效的下载文件' };
      }

      // 关闭标签页
      await page.close();
      this.okCallback(targetPath);
      return {
        success: true,
        message: `文件已成功处理并保存至: ${targetPath}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      this.emit('log', {
        message: `视频去水印出错: ${error.message}`,
        type: 'error',
      });
      if (page) await page.close().catch(() => {});
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
   */
  public async RunVideoQualityFix(filePath?: string, targetDir?: string) {
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

      this.emit('log', { message: '开始处理视频质量修复', type: 'info' });

      // 初始化浏览器和页面
      await PlaywrightScript.initBrowser(downloadDir);
      if (!PlaywrightScript.browser) throw new Error('无法初始化浏览器');
      page = await PlaywrightScript.browser.newPage();
      await page.goto('https://www.kaipai.com/video-tool/quality');
      await page.waitForLoadState('networkidle');

      // 上传文件
      const uploadArea = await page.waitForSelector(
        '.UploadContentV2_cardRightBox__s8gmc',
        { timeout: 30000 }
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
        '.index_categorgList__dF7ji > .index_categoryItem__pPv2U:nth-child(2)'
      );

      // 点击开始处理
      await page.click('.index_button__WWpyb');

      // 点击开始后等待5秒，避免网络延迟导致的状态误判
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 全局超时和检测间隔设置
      const maxWaitTime = 120 * 60 * 1000; // 2小时
      const checkInterval = 10 * 1000; // 10秒

      // 等待任务项DOM稳定
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 监控第一个任务项
      const trackListSelector = '.index_trackList__1mQ3P';
      const trackItemSelector = '.index_trackItem__vo4uQ';
      const firstItemSelector = `${trackListSelector} ${trackItemSelector}:first-child`;
      const exportBaseClass = 'index_button__Zm8pL';
      const retryClass = 'index_grayButton__UaZr0';
      const exportButtonSelector = `${firstItemSelector} .${exportBaseClass}:not(.${retryClass})`;

      // 等待第一个任务项出现
      let firstItemFound = false;
      const firstItemStart = Date.now();
      while (Date.now() - firstItemStart < maxWaitTime) {
        const firstItem = await page.$(firstItemSelector);
        if (firstItem) {
          firstItemFound = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      if (!firstItemFound) {
        throw new Error(`超过${maxWaitTime / 60000}分钟未找到第一个任务项`);
      }

      // 等待导出按钮可用
      let exportButton: any = null;
      let checkCount = 0;
      const exportBtnStart = Date.now();
      while (Date.now() - exportBtnStart < maxWaitTime) {
        checkCount++;
        exportButton = await page.$(exportButtonSelector);

        if (exportButton) {
          const isVisible = await exportButton.isVisible();
          const isEnabled = await exportButton.isEnabled();

          if (isVisible && isEnabled) {
            break;
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

      // 点击导出按钮并监听下载
      const downloadPromise = page.waitForEvent('download', {
        timeout: maxWaitTime,
      });
      await exportButton.click();

      // 检查目录变化（备用方案）
      const checkDownloadDir = async () => {
        const originalFiles = new Set(fs.readdirSync(downloadDir));
        return new Promise<string>((resolve, reject) => {
          const interval = setInterval(() => {
            const currentFiles = fs.readdirSync(downloadDir);
            for (const file of currentFiles) {
              if (!originalFiles.has(file) && !file.endsWith('.crdownload')) {
                clearInterval(interval);
                resolve(path.join(downloadDir, file));
                return;
              }
            }
          }, checkInterval);

          setTimeout(() => {
            clearInterval(interval);
            reject(new Error('目录监控超时'));
          }, maxWaitTime);
        });
      };

      // 并行等待：优先使用Playwright事件，失败则用目录监控
      let download: any, tempPath: string;
      try {
        download = await downloadPromise;
        tempPath = path.join(downloadDir, download.suggestedFilename());
        await download.saveAs(tempPath);
      } catch (e) {
        this.emit('log', {
          message: `下载事件监听失败，尝试目录监控: ${(e as Error).message}`,
          type: 'warning',
        });
        tempPath = await checkDownloadDir();
      }

      // 等待文件写入完成
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 验证临时文件
      if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) {
        throw new Error(`临时文件无效：${tempPath}`);
      }

      // 强制重命名为目标文件名
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        this.emit('log', {
          message: `已删除旧文件：${targetPath}`,
          type: 'info',
        });
      }
      fs.renameSync(tempPath, targetPath);

      // 验证最终文件
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0) {
        throw new Error(`最终文件无效：${targetPath}`);
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

      // 关闭标签页
      await page.close();

      return {
        success: true,
        message: `处理完成，文件保存至：${targetPath}`,
        filePath: targetPath,
      };
    } catch (error: any) {
      this.emit('log', {
        message: `操作失败：${error.message}`,
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
      // 确定下载目录
      const defaultDownloadDir = path.join(
        os.homedir(),
        'Downloads',
        'kaipai_output'
      );

      // 初始化浏览器实例
      await PlaywrightScript.initBrowser(defaultDownloadDir);

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

      // 未登录则执行自动登录流程
      if (!isLoggedIn) {
        this.emit('log', { message: '开始执行自动登录...', type: 'info' });

        try {
          // 1. 点击登录按钮打开弹窗
          await page.click('.index_account-action__g6gW5');
          await page.waitForTimeout(500); // 等待弹窗加载

          // 2. 点击微信图标切换到手机号登录（根据实际页面逻辑调整）
          const wechatLocator = page.locator('[key="wechat"]');
          await wechatLocator.waitFor({ state: 'visible' });
          await wechatLocator.click();
          await page.waitForTimeout(500);

          // 3. 点击注册链接切换到密码登录
          const registerLinkLocator = page.locator('.register-link');
          await registerLinkLocator.waitFor({ state: 'visible' });
          await registerLinkLocator.click();
          await page.waitForTimeout(500);

          // 4. 定位输入框容器并输入账号密码
          const inputGroupLocator = page.locator('.input-group');

          // 手机号输入框（input-group下第一个input-item）
          const phoneInputLocator = inputGroupLocator
            .locator('.input-item')
            .nth(0)
            .locator('input');
          await phoneInputLocator.waitFor({ state: 'visible' });
          await phoneInputLocator.fill('13688629385');

          // 密码输入框（input-group下第二个input-item）
          const passwordInputLocator = inputGroupLocator
            .locator('.input-item')
            .nth(1)
            .locator('input');
          await passwordInputLocator.waitFor({ state: 'visible' });
          await passwordInputLocator.fill('weibiz5568!');

          // 5. 点击提交按钮登录
          const submitButtonLocator = page.locator('.form-submit');
          await submitButtonLocator.waitFor({ state: 'visible' });
          await submitButtonLocator.click();

          // 6. 等待登录完成并验证登录状态
          await page.waitForLoadState('networkidle');
          const postLoginCount = await page.locator(avatarSelector).count();
          isLoggedIn = postLoginCount > 0;

          if (isLoggedIn) {
            this.emit('log', { message: '自动登录成功', type: 'success' });
          } else {
            this.emit('log', {
              message: '自动登录后未检测到登录状态',
              type: 'warning',
            });
          }
        } catch (loginError) {
          this.emit('log', {
            message: `自动登录过程出错: ${(loginError as Error).message}`,
            type: 'error',
          });
          throw new Error(`自动登录失败: ${(loginError as Error).message}`);
        }
      }

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
}

export default PlaywrightScript;

import { ipcMain } from 'electron';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 脚本1：视频去水印处理
 */
export async function runWatermarkRemoval(filePath?: string, targetDir?: string) {
  let browser;

  try {
    // 获取当前系统用户名
    const username = os.userInfo().username;
    const userDataDir = path.join('C:\\', `kaipai_${username}_data`);

    // 确定下载目录
    const defaultDownloadDir = path.join(os.homedir(), 'Downloads', 'kaipai_output');
    const downloadDir = targetDir ? path.resolve(targetDir) : defaultDownloadDir;

    console.log(`下载目录: ${downloadDir}`);
    console.log(`用户数据目录: ${userDataDir}`);

    // 确保目录存在
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
      console.log(`已创建下载目录: ${downloadDir}`);
    }

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      console.log(`已为用户 ${username} 创建数据目录: ${userDataDir}`);
    } else {
      console.log(`使用用户 ${username} 的现有数据目录: ${userDataDir}`);
    }

    // 启动浏览器
    browser = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      acceptDownloads: true,
      downloadsPath: downloadDir
    });

    // 获取页面实例
    const page = browser.pages().length > 0 ? browser.pages()[0] : await browser.newPage();

    // 打开网页并等待加载
    await page.goto('https://www.kaipai.com/video-tool/remove-watermark');
    await page.waitForLoadState('networkidle');
    console.log('页面加载完成');
    console.log('文件路径:', filePath);
    // 验证文件路径
    if (!filePath || !fs.existsSync(filePath)) {
      const errorMsg = filePath ? `文件不存在，请检查路径: ${filePath}` : '未提供有效的文件路径';
      throw new Error(errorMsg);
    }
    console.log('文件存在，准备上传');

    // 上传文件
    console.log('等待上传区域出现...');
    const uploadArea = await page.waitForSelector('.UploadContentV2_cardRightBox__s8gmc', {
      timeout: 30000
    });

    console.log('点击上传区域，触发文件选择框...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      uploadArea.click()
    ]);

    await fileChooser.setFiles(filePath);
    console.log(`文件上传成功: ${filePath}`);

    // 处理分类选择
    console.log('等待上传处理完成，页面跳转至分类选择...');
    await page.waitForSelector('.index_categorgList__dF7ji', { timeout: 60000 });
    console.log('上传完成，分类列表已加载');

    const secondCategorySelector =
      '.index_categorgList__dF7ji > .index_categoryItem__pPv2U:nth-child(1)';

    const secondCategory = await page.waitForSelector(secondCategorySelector, {
      timeout: 30000
    });
    await secondCategory.click();
    console.log('已点击去水印选项');

    // 开始处理
    const startBtnSelector = '.index_button__WWpyb';
    const startButton = await page.waitForSelector(startBtnSelector, {
      timeout: 30000
    });

    await startButton.click();
    console.log('已点击开始处理');

    // 处理登录
    console.log('检查是否需要登录...');
    const loginPopupSelector = '.meitu-account-quick-login-popup-container';

    try {
      await page.waitForSelector(loginPopupSelector, {
        state: 'visible',
        timeout: 5000
      });

      console.log(`检测到登录弹窗，请用户 ${username} 手动登录...`);
      await page.waitForSelector(loginPopupSelector, {
        state: 'hidden',
        timeout: 120000
      });
      console.log(`用户 ${username} 登录完成，继续执行...`);
    } catch (error) {
      console.log('未检测到登录弹窗，继续执行...');
    }

    // 等待处理完成并下载
    console.log('等待处理完成...');
    const exportButtonSelector = '.index_buttonBox__-1roP .index_exportButton__4OdAj';

    try {
      await page.waitForFunction(
        (sel) => {
          const btn = document.querySelector(sel);
          return btn && !btn.classList.contains('index_disabled__Xu0Xz');
        },
        exportButtonSelector,
        { timeout: 300000 }
      );

      console.log('处理完成，导出按钮已可用');

      // 监听所有下载事件，处理可能出现的多个文件
      console.log('准备下载文件...');
      const downloads: any = [];
      const downloadPromise = new Promise((resolve) => {
        const listener = (download: any) => {
          downloads.push(download);
          // 等待2秒，确保所有可能的下载都被捕获
          setTimeout(() => {
            page.off('download', listener);
            resolve(downloads);
          }, 2000);
        };
        page.on('download', listener);
        page.click(exportButtonSelector);
      });

      const allDownloads: any = await downloadPromise;
      console.log(`共捕获到 ${allDownloads.length} 个下载文件`);

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
        // 判断是否为UUID文件
        const isUuidFile = uuidPattern.test(fileName);

        if (!isUuidFile) {
          // 处理有效文件：替换S1-为S2-
          let processedName = fileName;
          if (processedName.startsWith('S1-')) {
            processedName = processedName.replace('S1-', 'S2-');
            console.log(`已替换前缀，新文件名: ${processedName}`);
          }

          // 确保是MP4文件
          if (!processedName.endsWith('.mp4')) {
            processedName = `${processedName}.mp4`;
            console.log(`已添加MP4扩展名: ${processedName}`);
          }

          // 保存有效文件
          targetPath = path.join(downloadDir, processedName);
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
            console.log(`已删除同名旧文件: ${targetPath}`);
          }
          await download.saveAs(targetPath);
          console.log(`有效文件已保存至: ${targetPath}`);
        } else {
          // 处理UUID文件：保存后删除
          const tempPath = path.join(downloadDir, fileName);
          await download.saveAs(tempPath);
          console.log(`UUID文件已临时保存至: ${tempPath}`);

          // 删除UUID文件
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            console.log(`已删除UUID冗余文件: ${tempPath}`);
          }
        }
      }

      if (!targetPath) {
        return { success: false, message: '未找到有效的下载文件' };
      }

      await browser.close();
      return {
        success: true,
        message: `文件已成功处理并保存至: ${targetPath}`,
        filePath: targetPath
      };
    } catch (error: any) {
      const isDisabled = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        return btn && btn.classList.contains('index_disabled__Xu0Xz');
      }, exportButtonSelector);

      if (isDisabled) {
        console.log('处理失败，导出按钮仍处于禁用状态');
        return { success: false, message: '处理失败，导出按钮仍处于禁用状态' };
      } else {
        console.log('等待处理超时或未找到导出按钮，请手动查看页面', error.message);
        return { success: false, message: `等待处理超时或未找到导出按钮: ${error.message}` };
      }
    }
  } catch (error: any) {
    console.error('操作过程中出现错误:', error.message);
    return { success: false, message: `操作过程中出现错误: ${error.message}` };
  } finally {
    console.log('操作完成，浏览器保持打开状态');
  }
}

/**
 * 脚本2：检查指定页面的登录状态
 */
export async function checkLoginStatus(targetUrl = 'https://www.kaipai.com/home') {
  let browser;

  try {
    // 获取当前系统用户名
    console.log('获取当前系统用户名...');
    const username = os.userInfo().username;
    // 为每个用户创建独立的数据目录，避免冲突
    const userDataDir = path.join('C:\\', `kaipai_${username}_data`);

    // 确保用户数据目录存在
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      console.log(`已为用户 ${username} 创建数据目录: ${userDataDir}`);
    } else {
      console.log(`使用用户 ${username} 的现有数据目录: ${userDataDir}`);
    }

    // 启动浏览器
    browser = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      viewport: null, // 使用默认窗口大小
      acceptDownloads: true
    });

    // 创建新页面
    const page = await browser.newPage();

    // 导航到目标URL
    console.log(`正在访问页面: ${targetUrl}`);
    await page.goto(targetUrl);
    await page.waitForLoadState('networkidle');
    console.log('页面加载完成');

    // 检查是否存在登录标识元素
    console.log('开始检测登录状态...');
    const avatarSelector = '.index_accountAvatar__gOrHw';
    const elementCount = await page.locator(avatarSelector).count();
    const isLoggedIn = elementCount > 0;

    console.log(`登录状态检测结果: ${isLoggedIn ? '已登录' : '未登录'}`);

    // 关闭浏览器
    await browser.close();

    // 根据登录状态返回不同结果
    return {
      success: isLoggedIn,
      message: isLoggedIn
        ? '检测到用户已登录（发现账户头像元素）'
        : '未检测到用户登录状态（未发现账户头像元素）',
      isLoggedIn: isLoggedIn // 明确返回登录状态
    };
  } catch (error: any) {
    console.error('登录状态检测过程中出现错误:', error.message);
    return {
      success: false,
      message: `登录状态检测失败: ${error.message}`,
      isLoggedIn: null // 错误情况下登录状态为null
    };
  } finally {
    // 确保浏览器被关闭
    if (browser) {
      try {
        await browser.close();
        console.log('浏览器已关闭');
      } catch (closeErr: any) {
        console.error('关闭浏览器时出错:', closeErr.message);
      }
    }
  }
}


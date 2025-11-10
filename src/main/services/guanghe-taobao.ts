import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import http from 'http';

class PlaywrightScript extends EventEmitter {
  // 静态属性
  private static chromePath: string = '';

  /**
   * 视频去水印处理
   */
  // 初始化浏览器实例 - 采用CDP方式
  private static async initBrowser() {
    // 使用Chrome默认配置文件，保留登录状态
    return new Promise(async resolve => {
      try {
        console.log('开始初始化浏览器实例，使用默认用户配置');
        // 为每次调用生成唯一的调试端口，避免端口冲突
        const debugPort = 9222 + Math.floor(Math.random() * 1000);
        const remoteDebuggingUrl = `http://127.0.0.1:${debugPort}`;

        // 设置Chrome路径
        PlaywrightScript.chromePath =
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

        // 使用Chrome的默认用户数据目录，保留登录状态
        const username = os.userInfo().username;
        const browserUserDataDir = path.join(
          'C:\\Users\\',
          username,
          'AppData\\Local\\Google\\Chrome\\User Data\\Default'
        );

        console.log(`使用Chrome默认用户数据目录: ${browserUserDataDir}`);
        console.log('准备启动新的Chrome浏览器实例');

        // 启动Chrome浏览器，使用动态生成的端口
        console.log('启动Chrome浏览器...');
        const browser = await PlaywrightScript.startChromeWithDebugPort(
          debugPort,
          browserUserDataDir
        );

        // 等待Chrome完全启动，增加等待时间
        console.log('等待Chrome浏览器完全启动...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Chrome浏览器启动完成，准备连接...');

        // 连接浏览器，增加重试次数
        const connectedBrowser = await PlaywrightScript.connectToBrowserAsync(
          remoteDebuggingUrl,
          5,
          3000
        );

        if (!connectedBrowser) {
          console.error('浏览器连接失败');
          return;
        }

        console.log('浏览器初始化成功，已准备就绪');
        resolve(connectedBrowser);
      } catch (error: any) {
        console.error('初始化浏览器失败:', error.message);
      }
    });
  }

  /**
   * 检查指定端口是否可用
   */
  private static async isPortAvailableAsync(port: number): Promise<boolean> {
    return new Promise(resolve => {
      // 使用127.0.0.1而不是localhost避免IPv6问题
      const options = {
        hostname: '127.0.0.1',
        port: port,
        path: '/json/version',
        method: 'GET',
        timeout: 2000,
      };

      const req = http.request(options, res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          // 检查响应是否为有效的JSON
          try {
            JSON.parse(data);
            resolve(res.statusCode === 200);
          } catch (e) {
            resolve(false);
          }
        });
      });

      req.on('error', error => {
        console.log(`端口检查错误: ${error.message}`);
        resolve(false);
      });

      req.on('timeout', () => {
        console.log(`端口检查超时: ${port}`);
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * 启动带远程调试端口的Chrome浏览器
   */
  private static async startChromeWithDebugPort(
    debugPort: number,
    userDataDir: string
  ): Promise<boolean> {
    // 使用默认用户数据目录时不需要创建，只需要验证是否存在
    if (!fs.existsSync(userDataDir)) {
      console.warn(`警告: 默认用户数据目录不存在: ${userDataDir}`);
    }

    // 移除路径中的引号，避免路径解析问题
    const cleanUserDataDir = userDataDir.replace(/"/g, '');

    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--remote-debugging-address=127.0.0.1`, // 指定绑定到IPv4地址
      `--user-data-dir=${cleanUserDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
      // 添加绕过检测的参数
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--flag-switches-begin',
      '--disable-site-isolation-trials',
      '--flag-switches-end',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
    ];

    try {
      console.log(
        `启动Chrome命令: ${PlaywrightScript.chromePath} ${args.join(' ')}`
      );
      // 使用execFile启动Chrome
      execFile(PlaywrightScript.chromePath, args, {
        windowsHide: false,
        detached: true, // 让Chrome在独立进程中运行
      });
      console.log(
        `Chrome浏览器已启动，调试端口: ${debugPort}，使用默认用户数据目录`
      );
      return true;
    } catch (error: any) {
      console.error(`无法启动Chrome浏览器: ${error.message}`);
      // 尝试使用另一种方式启动Chrome
      try {
        const { exec } = require('child_process');
        // 使用start命令启动，注意路径中包含空格的处理
        const command = `start "" "${PlaywrightScript.chromePath}" ${args
          .map(arg => `"${arg}"`)
          .join(' ')}`;
        console.log(`尝试使用start命令启动: ${command}`);
        exec(command);
        return true;
      } catch (innerError: any) {
        console.error(`使用start命令启动Chrome也失败: ${innerError.message}`);
        return false;
      }
    }
  }

  /**
   * 连接到浏览器，支持重试机制
   */
  private static async connectToBrowserAsync(
    remoteDebuggingUrl: string,
    maxRetries: number = 5,
    retryDelay: number = 3000
  ): Promise<any> {
    // 从URL中提取端口号
    const portMatch = remoteDebuggingUrl.match(/:(\d+)/);
    const port = portMatch ? parseInt(portMatch[1], 10) : 9222;

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`尝试连接到Chrome浏览器... (第${i + 1}/${maxRetries}次)`);
        console.log(`连接URL: ${remoteDebuggingUrl}`);

        // 先检查端口是否真的可以连接
        const isPortOpen = await PlaywrightScript.isPortAvailableAsync(port);
        console.log(`端口检查结果: ${isPortOpen ? '可用' : '不可用'}`);

        if (!isPortOpen && i < maxRetries - 1) {
          console.log(`端口暂时不可用，${retryDelay / 1000}秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // 使用connectOverCDP连接到已启动的Chrome
        const browser = await chromium.connectOverCDP(remoteDebuggingUrl, {
          slowMo: 50,
          timeout: 30000, // 增加超时时间
        });

        console.log('成功连接到Chrome浏览器');

        return browser;
      } catch (error: any) {
        console.error(`连接错误详情: ${error.stack || error.message}`);

        if (i === maxRetries - 1) {
          console.error(
            `连接浏览器失败，重试${maxRetries}次后仍然失败: ${error.message}`
          );
          return null;
        }

        console.log(
          `连接浏览器失败，${retryDelay / 1000}秒后重试... (第${i + 1}次)`
        );
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    return null;
  }

  // 不再需要静态的closeBrowser方法，因为每次调用都会创建独立的浏览器实例
  /**
   * 模拟人类输入文本
   * @param inputElement 输入框元素
   * @param text 要输入的文本
   */
  private async simulateHumanInput(inputElement: any, text: string) {
    // 根据输入类型设置固定的延迟范围
    let minDelay = 100;
    let maxDelay = 500;

    // 模拟人类逐个字符输入，每个字符有随机延迟
    for (let i = 0; i < text.length; i++) {
      await inputElement.type(text[i], { delay: 0 });
      // 随机延迟模拟人类输入速度变化
      const randomDelay =
        Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
      await new Promise(resolve => setTimeout(resolve, randomDelay));
    }
  }

  /**
   * 执行淘宝登录操作
   * @param page Playwright页面实例
   */
  private async loginToTaobao(page: any) {
    try {
      // 用户名输入框 - 模拟人类观察页面并定位输入框的过程
      await page.waitForSelector('.input-wrap-loginid', { timeout: 10000 });
      console.log('发现用户名输入框');
      await new Promise(resolve => setTimeout(resolve, 800)); // 模拟用户停顿

      const usernameInput = await page
        .locator('.input-wrap-loginid')
        .locator('input');

      if (await usernameInput.isVisible()) {
        // 使用通用输入方法
        await this.simulateHumanInput(usernameInput, '美刻信息科技:啦啦');
        // 输入完成后的自然停顿
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      // 密码框 - 模拟用户从用户名框移动到密码框的过程
      await page.waitForSelector('.input-wrap-password', { timeout: 10000 });
      console.log('发现密码输入框');
      await new Promise(resolve => setTimeout(resolve, 600)); // 模拟用户停顿

      const passwordInput = await page
        .locator('.input-wrap-password')
        .locator('input');

      if (await passwordInput.isVisible()) {
        // 使用通用输入方法
        await this.simulateHumanInput(passwordInput, 'z15898900999');
        // 输入完成后，模拟用户检查输入的停顿
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 点击登录按钮 - 模拟用户移动鼠标到按钮并点击
      console.log('查找登录按钮...');
      await page.waitForSelector('.fm-button', { timeout: 10000 });
      console.log('发现登录按钮，移动鼠标到按钮...');
      // 模拟鼠标移动到按钮的时间
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 模拟人类点击行为，可能有轻微延迟
      await page.click('.fm-button');
      console.log('登录按钮已点击');

      // 等待登录响应并处理弹窗
      console.log('等待登录响应...');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 点击弹窗的确认按钮
      await page.waitForSelector('.dialog-btn-ok', { timeout: 15000 });
      console.log('发现确认按钮，移动鼠标到按钮...');
      // 模拟鼠标移动到确认按钮的时间
      await new Promise(resolve => setTimeout(resolve, 700));

      await page.click('.dialog-btn-ok');
      console.log('确认按钮已点击');

      // 登录完成后的确认延迟
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('登录流程完成');
    } catch (error: any) {
      console.error('登录过程中出错:', error.message);
      throw new Error(`登录操作失败: ${error.message}`);
    }
  }

  public async GuangheTaobaoIssue() {
    let page: any = null;
    let browser: any = null;
    const USerData = {
      guangId: '4701623256',

      filePathArray: [
        'C:\\Users\\ASUS\\Downloads\\ces\\S1---33019725083-1-192.mp4',
        'C:\\Users\\ASUS\\Downloads\\ces\\S2---33019725083-1-192.mp4',
      ],
    };
    this.emit('log', {
      message: `开始发布到淘宝`,
      type: 'info',
    });
    try {
      // 初始化浏览器实例 - 使用默认用户配置
      browser = await PlaywrightScript.initBrowser();

      if (!browser) {
        const errorMsg = '无法初始化浏览器实例';
        console.error(errorMsg);
        this.emit('log', {
          message: errorMsg,
          type: 'error',
        });
        throw new Error(errorMsg);
      }

      // 获取第一个上下文或创建新上下文
      const context =
        browser.contexts()[0] ||
        (await browser.newContext({
          ignoreHTTPSErrors: true,
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }));

      // 创建新标签页
      page = await context.newPage();

      console.log('导航到淘宝光合平台...');
      await page.goto('https://mcn.guanghe.taobao.com/', { timeout: 60000 });
      await page.waitForLoadState('networkidle');

      // 直接在方法中检查是否需要登录
      let needsLogin = false;
      try {
        console.log('检查登录状态...');
        const loginElement = await page.locator('.content-layout').first();
        needsLogin = await loginElement.isVisible();
      } catch (error) {
        needsLogin = true;
      }

      if (needsLogin) {
        // 执行登录操作
        await this.loginToTaobao(page);
      }

      try {
        const closeBtn = await page.locator('.next-icon-close').first();

        if (await closeBtn.isVisible()) {
          await closeBtn.click({ timeout: 5000 });
          console.log('弹窗关闭成功');
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log('未发现弹窗关闭图标，可能弹窗未出现');
        }
      } catch (error: any) {
        console.error('关闭弹窗时发生错误:', error.message);
      }

      // 点击达人管理
      await page.locator('.next-menu-sub-menu > li').nth(1).click();
      await new Promise(resolve => setTimeout(resolve, 5000));

      const userNameInput = await page
        .locator('.search-view > .next-input')
        .locator('input');

      // 使用通用输入方法
      if (await userNameInput.isVisible()) {
        console.log('发现用户名输入框');
        await this.simulateHumanInput(userNameInput, USerData.guangId);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      // 点击搜索按钮
      await page.locator('.search-view > button').nth(0).click();

      // 等待搜索结果加载
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 点击达人的发布
      const userCheckbox = await page
        .locator('.next-table-row')
        .first()
        .locator('.next-table-cell')
        .last()
        .locator('.m-home-detach')
        .nth(1);
      if (await userCheckbox.isVisible()) {
        await userCheckbox.click();
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      // 点击发视频
      await page.locator('.menu--Awalkj18 > li').first().click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      // 点击批量发布
      await page.locator('.next-menu-spacing-lr > ul > li').last().click();

      // 上传视频 - next-upload-dragable
      try {
        // 等待上传区域可见
        console.log('等待上传区域加载...');
        await page.waitForSelector('.next-upload-dragable', { timeout: 10000 });
        console.log('上传区域已加载');

        // 触发文件上传对话框
        const uploadPromise = page.waitForEvent('filechooser', {
          timeout: 10000,
        });

        console.log('点击上传区域...');
        await page.click('.next-upload-dragable', { delay: 200 });

        // 获取文件选择器
        console.log('等待文件选择器弹出...');
        const fileChooser = await uploadPromise;

        // 检查文件路径数组是否有效
        if (USerData.filePathArray && USerData.filePathArray.length > 0) {
          console.log(`准备上传 ${USerData.filePathArray.length} 个文件`);

          // 验证所有文件是否存在
          const validFiles = [];
          for (const filePath of USerData.filePathArray) {
            if (fs.existsSync(filePath)) {
              validFiles.push(filePath);
            }
          }

          if (validFiles.length > 0) {
            // 选择文件
            await fileChooser.setFiles(validFiles);
            console.log(`已选择 ${validFiles.length} 个有效文件进行上传`);

            // 等待上传完成（根据实际情况调整等待时间或添加上传进度检测）
            console.log('等待文件上传完成...');
            await new Promise(resolve => setTimeout(resolve, 10 * 1000)); // 等待20秒
            console.log('文件上传等待完成');
          }
        }
      } catch (uploadError: any) {
        console.error('视频上传过程中出错:', uploadError.message);
      }

      console.log('开始查找视频描述输入框...');
      try {
        // 获取iframe的contentFrame - 修正方法
        console.log('获取iframe内容...');
        const iframeSelector = 'iframe.publish-content--Cl3CtTGD';
        // 等待iframe元素出现
        await page.waitForSelector(iframeSelector, { timeout: 10000 });
        // 获取iframe元素
        const iframeElement = await page.$(iframeSelector);
        let frame = null;

        if (iframeElement) {
          // 获取iframe的contentFrame
          frame = await iframeElement.contentFrame();
        }

        if (frame) {
          console.log('成功获取到iframe内容');

          // 在iframe内查找视频描述输入框
          const describeInputWrapper = await frame
            .locator('.publish-content__title-input--inputWrap--3rmMJEo')
            .locator('span')
            .locator('input');

          console.log('开始输入视频描述...');
          await this.simulateHumanInput(
            describeInputWrapper,
            '暂时测试用视频描述'
          );

          // 开始输入标签
          const cesArr = ['ces', '123', 'sdjao'];
          const labelInput = await frame.locator('div[data-cangjie-editable]');
          if (await labelInput.isVisible()) {
            await labelInput.click();
            await labelInput.press('Control+A'); // 全选内容
            await labelInput.press('Delete'); // 删除选中内容

            for (const item of cesArr) {
              await this.simulateHumanInput(labelInput, `#${item}#`);
            }
          }

          // 点击话题活动
          await frame
            .locator('.publish-content__topic-v2--select--1E8f4Wd ')
            .click();

          const dialogInput = await frame
            .locator(
              '.next-dialog-body > .topic-v2-picker > .top-form > .next-input'
            )
            .locator('input');
          if (await dialogInput.isVisible()) {
            await this.simulateHumanInput(dialogInput, '测试');
            await dialogInput.press('Enter');

            await new Promise(resolve => setTimeout(resolve, 3 * 1000)); // 等待3秒
            await frame.locator('.right-list > div').nth(0).click();

            await new Promise(resolve => setTimeout(resolve, 1 * 1000)); // 等待1秒
            await frame.locator('.next-box > .next-btn-primary').click();



            
          }
        }
      } catch (describeError: any) {
        console.error('视频描述输入框处理出错:', describeError.message);
      }

      return {
        success: true,
        message: `已完成批量发布操作`,
      };
    } catch (error: any) {
      const errorMsg = `发布到淘宝出错: ${error.message}`;
      console.error(errorMsg);
      this.emit('log', {
        message: errorMsg,
        type: 'error',
      });
      // 清理资源
      if (page) await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      return {
        success: false,
        message: `操作失败: ${error.message}`,
      };
    }
  }
}

export default PlaywrightScript;

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
// import * as child_process from 'child_process';
import http from 'http';
import dayjs from 'dayjs';

class GuangheTaobao extends EventEmitter {
  // 静态属性
  private static chromePath: string = '';

  // 实例属性
  private filePathArray?: string[];
  private currentVideoIndex?: number;

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
        GuangheTaobao.chromePath =
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

        // 使用C盘根目录下的自定义用户数据目录
        const username = os.userInfo().username;
        const browserUserDataDir = path.join(
          'C:\\',
          `guanghe_${username}_data`
        );

        // 如果目录不存在，则创建
        try {
          if (!fs.existsSync(browserUserDataDir)) {
            fs.mkdirSync(browserUserDataDir, { recursive: true });
            console.log(`已创建用户数据目录: ${browserUserDataDir}`);
          }
        } catch (error: any) {
          console.error('创建用户数据目录失败:', error.message);
        }

        console.log(`使用Chrome默认用户数据目录: ${browserUserDataDir}`);
        console.log('准备启动新的Chrome浏览器实例');

        // 启动Chrome浏览器，使用动态生成的端口
        console.log('启动Chrome浏览器...');
        const browser = await GuangheTaobao.startChromeWithDebugPort(
          debugPort,
          browserUserDataDir
        );

        // 等待Chrome完全启动，增加等待时间
        console.log('等待Chrome浏览器完全启动...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Chrome浏览器启动完成，准备连接...');

        // 连接浏览器，增加重试次数
        const connectedBrowser = await GuangheTaobao.connectToBrowserAsync(
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
        `启动Chrome命令: ${GuangheTaobao.chromePath} ${args.join(' ')}`
      );
      // 使用require方式导入child_process以避免TypeScript类型错误
      const { execFile } = require('child_process');
      // 显式调用execFile，传入正确的参数
      execFile(GuangheTaobao.chromePath, args, {
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
        const command = `start "" "${GuangheTaobao.chromePath}" ${args
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
        const isPortOpen = await GuangheTaobao.isPortAvailableAsync(port);
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

  /**
   * 模拟人类输入文本
   * @param inputElement 输入框元素
   * @param text 要输入的文本
   */
  private async simulateHumanInput(inputElement: any, text: string) {
    // 根据输入类型设置固定的延迟范围
    let minDelay = 100;
    let maxDelay = 300;

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

  /**
   * 为单个视频填写信息
   * @param frame 视频编辑的iframe
   */
  private async fillVideoInfo(frame: any, UserData: any) {
    try {
      // 在iframe内查找视频描述输入框
      const describeInputWrapper = await frame
        .locator('.publish-content__title-input--inputWrap--3rmMJEo')
        .locator('span')
        .locator('input');

      console.log('开始输入视频描述...');
      await this.simulateHumanInput(
        describeInputWrapper,
        UserData.videoDescription
      );

      // 开始输入标签
      const labelArr = UserData.videoTags.split(',');
      const labelInput = await frame.locator('div[data-cangjie-editable]');
      if (await labelInput.isVisible()) {
        console.log('开始输入标签');
        await labelInput.click();
        await labelInput.press('Control+A'); // 全选内容
        await labelInput.press('Delete'); // 删除选中内容

        for (const item of labelArr) {
          await this.simulateHumanInput(labelInput, `#${item}#`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
      // 点击话题活动
      await frame
        .locator('.publish-content__topic-v2--select--1E8f4Wd ')
        .click();
      console.log('打开话题活动');

      const dialogInput = await frame
        .locator(
          '.next-dialog-body > .topic-v2-picker > .top-form > .next-input'
        )
        .locator('input');
      if (await dialogInput.isVisible()) {
        await this.simulateHumanInput(dialogInput, UserData.topic);
        await dialogInput.press('Enter');

        await new Promise(resolve => setTimeout(resolve, 1 * 1000));
        await frame.locator('.right-list > div').nth(0).click();

        await new Promise(resolve => setTimeout(resolve, 1 * 1000));
        await frame.locator('.next-box > .next-btn-primary').click();
      }

      // 打开关联商品
      await frame
        .locator('.publish-content__item-v2--items-trigger-hover--iJJrjD2')
        .click();
      await new Promise(resolve => setTimeout(resolve, 2 * 1000));
      const itemList = await frame
        .locator('.publish-content__item-v2--tabName--3Lp7Xq6')
        .all();
      console.log('关联商品选项数量:', itemList.length);

      await new Promise(resolve => setTimeout(resolve, 2 * 1000));
      // 检查是否有选品车
      let hasProductCart = false;
      for (const item of itemList) {
        const text = await item.textContent();
        if (text && text.includes('选品车')) {
          hasProductCart = true;
          break;
        }
      }

      console.log(`当前guangCatalogue: ${UserData.guangCatalogue}`);
      console.log(`是否找到选品车: ${hasProductCart}`);

      // 简化的选品车处理逻辑
      const shouldUseProductCart =
        UserData.guangCatalogue.startsWith('A0') ||
        UserData.guangCatalogue.startsWith('A1');

      if (shouldUseProductCart) {
        if (UserData.guangCatalogue.startsWith('A0')) {
          if (hasProductCart) {
            // A0有选品车，改为A1并继续发布
            console.log('A0有选品车，改为A1并继续发布');
            UserData.guangCatalogue = UserData.guangCatalogue.replace(
              /^A0/,
              'A1'
            );
            await this.selectProductFromCart(frame, UserData.productId);
          } else {
            // A0没有选品车，继续发布
            console.log('A0没有选品车，继续发布');
            const closeButton = await frame.locator('.next-dialog-close-icon');
            await closeButton.click();
          }
        } else if (UserData.guangCatalogue.startsWith('A1')) {
          if (hasProductCart) {
            // A1有选品车，正常选择商品
            console.log('A1有选品车，正常选择商品');
            await this.selectProductFromCart(frame, UserData.productId);
          } else {
            // A1没有选品车，抛出错误让上层处理
            console.error('A1没有选品车，抛出错误');
            throw new Error('A1类型需要选品车，但未找到选品车选项');
          }
        }
      } else {
        // 其他类型，按原有逻辑处理
        console.log('其他类型，按原有逻辑处理选品车');
        if (hasProductCart) {
          await this.selectProductFromCart(frame, UserData.productId);
        } else {
          const closeButton = await frame.locator('.next-dialog-close-icon');
          await closeButton.click();
        }
      }

      console.log('开始选中定时');
      await frame
        .locator('.fixed-btn-container > div')
        .nth(1)
        .locator('div > div')
        .nth(1)
        .locator('div')
        .first()
        .locator('label')
        .click();

      // 设置定时发布时间（从第二个视频开始）
      if ((this.currentVideoIndex as number) > 0) {
        await this.setScheduledTime(
          frame,
          this.currentVideoIndex as number,
          this.filePathArray?.length || 1
        );
      }
      // 点击自主拍摄
      // await frame
      //   .locator('.publish-content__publish-button--claim--1-9WKPP') // 唯一父容器
      //   .locator('.next-radio-group') // 单选框组
      //   .locator('.next-radio-wrapper:has(.next-radio-label:text("自主拍摄"))') // 包含"自主拍摄"文本的选项
      //   .click();
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * 从选品车选择商品
   */
  private async selectProductFromCart(frame: any, productId: string) {
    // 点击选品车
    const itemList = await frame
      .locator('.publish-content__item-v2--tabName--3Lp7Xq6')
      .all();
    for (const item of itemList) {
      const text = await item.textContent();
      if (text && text.includes('选品车')) {
        await item.click();
        break;
      }
    }

    // 等待选品车内容加载
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 选择选品车中的商品
    try {
      const Input = await frame.locator(
        '.next-select-auto-complete > span > input'
      );
      await this.simulateHumanInput(Input, productId);
      await Input.press('Enter');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const productSelect = await frame
        .locator('.publish-content__item-v2--item--1zog_Vq')
        .all();
      if (productSelect.length > 0) {
        await productSelect[0].click();
      }
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 点击确认按钮
      await frame
        .locator('.publish-content__item-v2--dialog-footer-right--10eXc-h')
        .locator('button')
        .first()
        .click();
      await new Promise(resolve => setTimeout(resolve, 1200));
    } catch (productError: any) {
      console.error('选择商品过程中出错:', productError.message);
    }
  }

  /**
   * 设置定时发布时间
   * @param frame iframe上下文
   * @param videoIndex 当前视频索引（从0开始）
   * @param totalVideos 总视频数量
   */
  private async setScheduledTime(
    frame: any,
    videoIndex: number,
    totalVideos: number
  ) {
    try {
      console.log(`设置第${videoIndex + 1}个视频的定时发布时间`);

      // 基础时间：第一个视频使用2小时后时间
      const baseTime = dayjs().add(2, 'hour');

      // 计算剩余时间（到当天结束）
      const endOfDay = dayjs().endOf('day');
      const remainingTime = endOfDay.diff(baseTime, 'hour');

      let scheduledTime;

      // 检查是否跨天
      const firstVideoCrossDay = baseTime.date() !== dayjs().date();

      if (firstVideoCrossDay) {
        // 如果第一个视频就跨天，保持各向后延迟2小时
        scheduledTime = baseTime.add(videoIndex * 2, 'hour');
        console.log(`第一个视频已跨天，保持各向后延迟2小时`);
      } else {
        // 计算剩余需要分配时间的视频数量
        const remainingVideos = totalVideos - 1; // 除去第一个视频

        if (remainingTime >= remainingVideos * 2) {
          // 如果时间充足，按2小时间隔
          scheduledTime = baseTime.add(videoIndex * 2, 'hour');
          console.log(
            `时间充足，按2小时间隔: ${scheduledTime.format('HH:mm')}`
          );
        } else {
          // 如果时间不足，平均分配剩余时间
          const interval = remainingTime / remainingVideos;
          scheduledTime = baseTime.add(videoIndex * interval, 'hour');
          console.log(
            `时间不足，平均分配剩余时间，间隔${interval.toFixed(
              1
            )}小时: ${scheduledTime.format('HH:mm')}`
          );
        }
      }

      console.log(`计算发布时间: ${scheduledTime.format('YYYY-MM-DD HH:mm')}`);

      // 点击日期选择器
      await frame.locator('.next-date-picker-input').click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 获取所有时间输入框
      const timeInputs = await frame
        .locator('.next-date-picker-panel-input')
        .locator('input[placeholder="HH:mm"]')
        .all();

      if (timeInputs.length >= 2) {
        // 使用第二个时间输入框
        const timeInput = timeInputs[1];

        // 全选并删除现有内容
        await timeInput.click();
        await timeInput.press('Control+A');
        await timeInput.press('Delete');

        // 输入新的时间
        const timeStr = scheduledTime.format('HH:mm');
        await this.simulateHumanInput(timeInput, timeStr);
        console.log(`已输入时间: ${timeStr}`);
      }

      // 点击确认按钮
      const confirmButtons = await frame
        .locator('.next-date-picker-panel-footer')
        .locator('.next-btn-primary')
        .all();

      if (confirmButtons.length >= 2) {
        // 点击第二个确认按钮
        await confirmButtons[1].click();
        console.log('已点击确认按钮');
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`第${videoIndex + 1}个视频定时发布时间设置完成`);
    } catch (error: any) {
      console.error(`设置定时发布时间失败: ${error.message}`);
      // 不抛出错误，继续执行后续步骤
    }
  }

  // 整体调用
  public async GuangheTaobaoIssue() {
    let page: any = null;
    let browser: any = null;
    const UserData = {
      guangId: '4687647364',
      filePathArray: [
        'C:\\Users\\ASUS\\Downloads\\ces\\S6---47---西域美农欧若姆草原烤酸奶118g儿童奶制品零食烤酸奶脆片内蒙特产---902014630853---kb_5VQIG---1.mp4',
        'C:\\Users\\ASUS\\Downloads\\ces\\S6---47---西域美农欧若姆草原烤酸奶118g儿童奶制品零食烤酸奶脆片内蒙特产---902014630853---kb_5VQIG---2.mp4',
        'C:\\Users\\ASUS\\Downloads\\ces\\S6---13---【泉城好礼】佳宝泉城系列把子肉风味酸奶济南特产礼盒赠冰箱贴---824574247714---X-wkc21S---3.mp4',
        // 'C:\\Users\\ASUS\\Downloads\\ces\\S6---47---西域美农欧若姆草原烤酸奶118g儿童奶制品零食烤酸奶脆片内蒙特产---902014630853---kb_5VQIG---4.mp4',
      ],
      videoData: {
        guangCatalogue: 'A0---美瞳变色龙---美妆---4701623256---20251106---0',
        videoDescription: '',
        productId: '',
        videoTags: '好物分享,美食推荐',
        topic: '做个美食家',
      },
    };
    UserData.videoData.videoDescription =
      UserData.filePathArray[0].split('---')[2];
    UserData.videoData.productId = UserData.filePathArray[0].split('---')[3];
    console.log(UserData.videoData.videoDescription);
    console.log(UserData.videoData.productId);

    // 设置实例属性
    this.filePathArray = UserData.filePathArray;
    this.currentVideoIndex = 0;
    this.emit('log', {
      message: `开始发布到淘宝`,
      type: 'info',
    });

    // 计时器，监控验证弹窗
    let iframeDetection = null;
    try {
      // 初始化浏览器实例 - 使用默认用户配置
      browser = await GuangheTaobao.initBrowser();

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
        await new Promise(resolve => setTimeout(resolve, 2000));
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
      await new Promise(resolve => setTimeout(resolve, 3000));

      const userNameInput = await page
        .locator('.search-view > .next-input')
        .locator('input');

      // 使用通用输入方法
      if (await userNameInput.isVisible()) {
        console.log('发现用户名输入框');
        await this.simulateHumanInput(userNameInput, UserData.guangId);
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
      await new Promise(resolve => setTimeout(resolve, 1000));
      // 点击发视频
      await page.locator('.menu--Awalkj18 > li').first().click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      // 点击批量发布
      await page.locator('.next-menu-spacing-lr > ul > li').last().click();

      // 上传视频 - next-upload-dragable
      try {
        // 等待上传区域可见
        console.log('等待上传区域加载...');
        await page.waitForSelector('.next-upload-dragable', { timeout: 8000 });
        console.log('上传区域已加载');

        // 检查文件路径数组是否有效
        if (UserData.filePathArray && UserData.filePathArray.length > 0) {
          console.log(`准备上传 ${UserData.filePathArray.length} 个文件`);

          // 验证所有文件是否存在
          const validFiles = [];
          for (const filePath of UserData.filePathArray) {
            if (fs.existsSync(filePath)) {
              validFiles.push(filePath);
            }
          }

          if (validFiles.length > 0) {
            // 第一步：上传第一个视频
            console.log('上传第一个视频...');
            const firstVideoFile = validFiles[0];
            console.log(`第一个视频文件: ${firstVideoFile}`);

            // 触发文件上传对话框
            const uploadPromise = page.waitForEvent('filechooser', {
              timeout: 8000,
            });
            await page.click('.next-upload-dragable', {
              delay: 200,
              noWaitAfter: true,
            });
            const fileChooser = await uploadPromise;
            await fileChooser.setFiles([firstVideoFile]);
            console.log('第一个视频已选择进行上传');

            // 等待第一个视频上传完成
            console.log('等待第一个视频上传完成...');
            await new Promise(resolve => setTimeout(resolve, 20000));
            console.log('第一个视频上传等待完成');

            // 等待iframe加载完成
            console.log('等待iframe加载完成...');
            await page.waitForSelector('iframe.publish-content--Cl3CtTGD', {
              timeout: 15000,
            });
            console.log('iframe已加载');

            // 获取iframe内容
            const iframeElement = await page.$(
              'iframe.publish-content--Cl3CtTGD'
            );
            let frame = null;
            if (iframeElement) {
              frame = await iframeElement.contentFrame();
              console.log('成功获取iframe内容');
            }

            // 逐个上传剩余的视频
            for (let i = 1; i < validFiles.length; i++) {
              console.log(`开始上传第${i + 1}个视频...`);

              if (frame) {
                // 在iframe中查找并点击"添加视频"按钮
                console.log('在iframe中查找"添加视频"按钮...');
                const addVideoButton = await frame.waitForSelector(
                  'span.next-btn-helper:has-text("添加视频")',
                  { timeout: 10000 }
                );

                if (addVideoButton) {
                  console.log('找到"添加视频"按钮，准备点击...');

                  // 触发文件上传对话框
                  const nextUploadPromise = page.waitForEvent('filechooser', {
                    timeout: 8000,
                  });

                  await addVideoButton.click({ delay: 200, noWaitAfter: true });
                  console.log('已点击"添加视频"按钮');

                  // 选择下一个视频文件
                  const nextFileChooser = await nextUploadPromise;
                  await nextFileChooser.setFiles([validFiles[i]]);
                  console.log(`已选择第${i + 1}个视频文件进行上传`);

                  // 等待当前视频上传完成
                  console.log(`等待第${i + 1}个视频上传完成...`);
                  await new Promise(resolve => setTimeout(resolve, 20000));
                  console.log(`第${i + 1}个视频上传等待完成`);
                } else {
                  console.error('未找到"添加视频"按钮');
                }
              } else {
                console.error('无法获取iframe内容');
              }
            }
          }
        }
      } catch (uploadError: any) {
        console.error('视频上传过程中出错:', uploadError.message);
        // 不抛出错误，继续执行后续步骤
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
        iframeDetection = setInterval(async () => {
          if (frame) {
            // 确保frame已获取
            try {
              // 检测是否存在类名为baxia-dialog-close的元素
              const closeBtn = await frame.$('.baxia-dialog-close');
              if (closeBtn) {
                // 存在则点击
                await new Promise(resolve => setTimeout(resolve, 2000));
                await closeBtn.click();
              }
            } catch (err) {}
          }
        }, 1000); // 每1000毫秒（1秒）检测一次
        if (frame) {
          // 获取所有视频的队列
          const videoQueue = await frame.locator('.batchItemWrap').all();
          for (let i = 0; i < videoQueue.length; i++) {
            // 更新当前视频索引
            this.currentVideoIndex = i;
            const video = videoQueue[i];
            await video.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.fillVideoInfo(frame, UserData.videoData);
          }

          const publishBtn = await frame
            .locator('.batch-button-area > div')
            .locator('button');
          if (await publishBtn.isVisible()) {
            // 点击批量发布按钮
            console.log('点击批量发布按钮...');

            // await publishBtn.click();
          }
        }
      } catch (describeError: any) {
        console.error('视频描述输入框处理出错:', describeError.message);
      }
      if (iframeDetection) clearInterval(iframeDetection);

      await new Promise(resolve => setTimeout(resolve, 2000));
      return {
        success: true,
        message: `已完成批量发布操作`,
      };
    } catch (error: any) {
      const errorMsg = `发布到淘宝出错: ${error.message}`;
      console.error(errorMsg);
      // 清理资源
      if (iframeDetection) clearInterval(iframeDetection);
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

export default GuangheTaobao;

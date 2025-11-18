import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
// import * as child_process from 'child_process';
import http from 'http';
import dayjs from 'dayjs';
import { GuangProcessor, GuangHePublishStatus } from './guang-processor';
import workbenchManager from './workbench-manager';

class GuangheTaobao extends EventEmitter {
  // 静态属性
  private static chromePath: string = '';

  // 实例属性
  private filePathArray?: string[];
  private currentVideoIndex?: number;

  // 新增属性：用于存储获取到的目录数组和定时器
  private guangGuangAccountDirectories: string[] = [];
  private isProcessingQueue: boolean = false;

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
        // GuangheTaobao.chromePath =
        //   'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

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
        const chromeProcess = await GuangheTaobao.startChromeWithDebugPort(
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

        // 将Chrome进程引用附加到浏览器实例上
        if (chromeProcess) {
          (connectedBrowser as any).chromeProcess = chromeProcess;
          console.log('Chrome进程引用已附加到浏览器实例');
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
  ): Promise<any> {
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
      '--no-startup-window', // 不自动打开新窗口
    ];

    try {
      console.log(
        `启动Chrome命令: ${GuangheTaobao.chromePath} ${args.join(' ')}`
      );
      // 使用require方式导入child_process以避免TypeScript类型错误
      const { spawn } = require('child_process');
      // 使用spawn而不是execFile，这样可以获取进程引用
      const chromeProcess = spawn(GuangheTaobao.chromePath, args, {
        windowsHide: false,
        detached: false, // 不分离进程，便于后续管理
        stdio: 'ignore', // 忽略标准输入输出
      });

      console.log(
        `Chrome浏览器已启动，调试端口: ${debugPort}，使用默认用户数据目录`
      );

      // 返回进程引用，便于后续清理
      return chromeProcess;
    } catch (error: any) {
      console.error(`无法启动Chrome浏览器: ${error.message}`);
      // 尝试使用另一种方式启动Chrome
      try {
        const { exec } = require('child_process');
        // 使用start命令启动，注意路径中包含空格的处理
        const command = `start "" "${GuangheTaobao.chromePath}" ${args
          .map((arg: string) => `"${arg}"`)
          .join(' ')}`;
        console.log(`尝试使用start命令启动: ${command}`);
        exec(command);
        return null; // exec方式无法获取进程引用
      } catch (innerError: any) {
        console.error(`使用start命令启动Chrome也失败: ${innerError.message}`);
        return null;
      }
    }
  }

  /**
   * 连接到浏览器，支持重试机制
   */
  private static async connectToBrowserAsync(
    remoteDebuggingUrl: string,
    maxRetries: number = 3,
    retryDelay: number = 2000
  ): Promise<any> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`尝试连接到Chrome浏览器... (第${i + 1}/${maxRetries}次)`);
        console.log(`连接URL: ${remoteDebuggingUrl}`);

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
    let minDelay = 50;
    let maxDelay = 200;

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
      // 使用当前视频索引对应的描述
      const currentDescription =
        UserData.videoDescription[this.currentVideoIndex as number] ||
        UserData.videoDescription;
      // await this.simulateHumanInput(describeInputWrapper, currentDescription);
      await describeInputWrapper.type(currentDescription);

      // 开始输入标签
      const labelInput = await frame.locator('div[data-cangjie-editable]');
      if (await labelInput.isVisible()) {
        console.log('开始输入标签');
        await labelInput.click();
        await labelInput.press('Control+A'); // 全选内容
        await labelInput.press('Delete'); // 删除选中内容

        for (const item of UserData.videoTags) {
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
        // 随机选择一个话题
        const randomTopic =
          UserData.topic[Math.floor(Math.random() * UserData.topic.length)];
        // await this.simulateHumanInput(dialogInput, randomTopic);
        await dialogInput.type(randomTopic);
        await dialogInput.press('Enter');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const isEmpty =
          (await frame.locator('.next-card-show-divider').count()) > 0;

        if (!isEmpty) {
          // 不存在空状态标识，说明有可选项，点击第一个话题
          console.log('找到第0个话题，点击选择');
          await frame.locator('.right-list > div').first().click();
          await new Promise(resolve => setTimeout(resolve, 1000));
          // 确认提交
          await frame.locator('.next-box > .next-btn-primary').click();
        } else {
          // 存在空状态标识，说明无内容，关闭对话框
          console.log('未找到话题（检测到空状态），关闭对话框');
          await frame.locator('.next-dialog-close').click();
        }
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

      // 选品车处理逻辑（优化版）
      // 仅处理A0/A1类型，其他类型直接抛出错误
      // if (
      //   !UserData.guangCatalogue.startsWith('A0') &&
      //   !UserData.guangCatalogue.startsWith('A1')
      // ) {
      //   throw new Error('目录类型必须为A0或A1');
      // }

      // // 获取当前视频对应的商品ID：不存在时直接置空（避免错乱）
      // const currentVideoIndex = this.currentVideoIndex || 0;
      // let currentProductId = '';
      // if (UserData.productIds && Array.isArray(UserData.productIds)) {
      //   // 严格匹配索引，不存在则置空（不 fallback 到第一个）
      //   currentProductId = UserData.productIds[currentVideoIndex] || '';
      // }

      // this.emit('log', {
      //   message: `当前视频索引: ${currentVideoIndex}, 对应商品ID: ${
      //     currentProductId || '空'
      //   }`,
      //   type: 'info',
      // });

      // 统一处理A0/A1的选品车逻辑（简化判断）
      // const isA0 = UserData.guangCatalogue.startsWith('A0');
      // const isA1 = UserData.guangCatalogue.startsWith('A1');

      // if (hasProductCart) {
      //   // 存在选品车时：A0先转为A1，再执行选品（若有商品ID）
      //   if (isA0) {
      //     UserData.guangCatalogue = UserData.guangCatalogue.replace(
      //       /^A0/,
      //       'A1'
      //     );
      //     console.log('A0有选品车，已转为A1');
      //   }

      //   // 无论A0/A1，只有存在商品ID时才执行选品，否则跳过
      //   if (currentProductId) {
      //     try {
      //       await this.selectProductFromCart(frame, currentProductId);
      //       console.log(
      //         `${isA0 ? 'A0转A1后' : 'A1'}选品成功，商品ID: ${currentProductId}`
      //       );
      //     } catch (error: any) {
      //       // 选品失败（如未找到商品）：关闭弹窗，不中断流程
      //       this.emit('log', {
      //         message: `${isA1 ? 'A1' : 'A0转A1后'}选品失败，关闭弹窗: ${
      //           error.message
      //         }`,
      //         type: 'error',
      //       });
      //       const closeButton = await frame.locator('.next-dialog-close-icon');
      //       await closeButton.click();
      //     }
      //   } else {
      //     // 无商品ID：直接关闭弹窗
      //     this.emit('log', {
      //       message: `${isA0 ? 'A0' : 'A1'}无商品ID，关闭选品车弹窗`,
      //       type: 'info',
      //     });
      //     const closeButton = await frame.locator('.next-dialog-close-icon');
      //     await closeButton.click();
      //   }
      // } else {
      //   // 不存在选品车时：A0/A1均关闭弹窗（A1不再强制报错）
      //   this.emit('log', {
      //     message: `${isA0 ? 'A0' : 'A1'}无选品车，关闭弹窗`,
      //     type: 'info',
      //   });
      //   const closeButton = await frame.locator('.next-dialog-close-icon');
      //   await closeButton.click();
      // }

      // 获取当前视频对应的商品ID
      const currentVideoIndex = this.currentVideoIndex || 0;
      let currentProductId = '';
      if (UserData.productIds && Array.isArray(UserData.productIds)) {
        currentProductId = UserData.productIds[currentVideoIndex] || '';
      }

      this.emit('log', {
        message: `当前视频索引: ${currentVideoIndex}, 对应商品ID: ${
          currentProductId || '空'
        }`,
        type: 'info',
      });

      // 核心逻辑：判断是否执行选品
      if (hasProductCart && currentProductId) {
        // 执行选品并处理结果
        const selectSuccess = await this.selectProductFromCart(
          frame,
          currentProductId
        );
        if (!selectSuccess) {
          await this.handleCartFailure(
            frame,
            UserData.guangId,
            `选品失败，商品未找到（商品ID: ${currentProductId}）`
          );
        }
      } else {
        // 不满足选品条件，直接处理失败
        const reason = !hasProductCart ? '未找到选品车' : '商品ID为空或不存在';
        await this.handleCartFailure(frame, UserData.guangId, reason);
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

      this.emit('log', {
        message: `已完成第${this.currentVideoIndex}个视频的选品车处理`,
        type: 'info',
      });
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
   * 从选品车选择商品（优化版）
   * @param frame iframe上下文
   * @param productId 商品ID
   * @returns 选品成功返回true，失败返回false
   */
  private async selectProductFromCart(
    frame: any,
    productId: string
  ): Promise<boolean> {
    // 前置判断：商品ID为空直接返回失败
    if (!productId) {
      console.error('商品ID为空，终止选品');
      return false;
    }

    try {
      // 1. 点击选品车标签（增加存在性判断）
      const itemList = await frame
        .locator('.publish-content__item-v2--tabName--3Lp7Xq6')
        .all();
      let cartTabFound = false;
      for (const item of itemList) {
        const text = await item.textContent();
        if (text && text.includes('选品车')) {
          await item.click();
          cartTabFound = true;
          break;
        }
      }
      if (!cartTabFound) {
        console.error('未找到选品车标签');
        return false;
      }

      // 2. 等待选品车内容加载
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. 输入商品ID并确认
      const input = await frame.locator(
        '.next-select-auto-complete > span > input'
      );
      if ((await input.count()) === 0) {
        console.error('未找到商品搜索输入框');
        return false;
      }
      await input.type(productId);
      await input.press('Enter');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 4. 匹配并点击目标商品
      const productItems = frame.locator(
        `div.publish-content__item-v2--item--1zog_Vq:has(a[href*="id=${productId}"])`
      );
      if ((await productItems.count()) === 0) {
        console.error(`未找到商品ID为 ${productId} 的选项`);
        return false;
      }
      await productItems.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 5. 点击确认按钮
      const confirmButton = frame
        .locator('.publish-content__item-v2--dialog-footer-right--10eXc-h')
        .locator('button')
        .first();
      if ((await confirmButton.count()) === 0) {
        console.error('未找到确认按钮');
        return false;
      }
      await confirmButton.click();
      await new Promise(resolve => setTimeout(resolve, 1200));

      console.log(`商品 ${productId} 选品成功`);
      return true;
    } catch (productError: any) {
      console.error('选品过程出错:', productError.message);
      return false;
    }
  }

  /**
   * 封装挂车失败处理逻辑：记录错误日志并关闭弹窗
   * @param frame iframe上下文
   * @param guangId 账号ID
   * @param reason 失败原因
   */
  private async handleCartFailure(frame: any, guangId: string, reason: string) {
    const fs = require('fs');
    const path = require('path');
    const logPath =
      '\\\\192.168.31.99\\影视存储\\逛逛客户端\\逛逛账号\\logs\\productError.txt';

    // 1. 记录错误日志
    const logContent = `[${new Date().toLocaleString()}] 账号 ${guangId} 挂车失败，原因：${reason}\n`;
    try {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logPath, logContent, 'utf8');
      console.log(`错误已记录: ${reason}`);
    } catch (logError: any) {
      console.error('日志写入失败:', logError.message);
    }

    // 2. 关闭弹窗（容错处理，避免元素不存在导致报错）
    try {
      const closeButton = frame.locator('.next-dialog-close-icon');
      if ((await closeButton.count()) > 0) {
        await closeButton.click();
        console.log('已关闭选品弹窗');
      }
    } catch (closeError: any) {
      console.error('关闭弹窗失败:', closeError.message);
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

      // 获取第二个日期选择器下的时间输入框
      // 直接用组合选择器选中时间输入框
      const timeInput = await frame.locator(
        '.next-date-picker-panel-input input[placeholder="HH:mm"]'
      );

      // 全选并删除现有内容
      await timeInput.click();
      await timeInput.press('Control+A');
      await timeInput.press('Delete');

      // 输入新的时间
      const timeStr = scheduledTime.format('HH:mm');
      // await this.simulateHumanInput(timeInput, timeStr);
      await timeInput.type(timeStr);
      console.log(`已输入时间: ${timeStr}`);

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
  public async GuangheTaobaoIssue(UserData: any) {
    if (!(await workbenchManager.getByKey('s8')).running) {
      console.log('s8任务未运行,停止调用');
      return;
    }
    let page: any = null;
    let browser: any = null;
    let iframeDetection: any = null;

    // 定义清理函数，确保资源正确释放
    const cleanup = async () => {
      try {
        if (iframeDetection) {
          clearInterval(iframeDetection);
          iframeDetection = null;
        }
        if (page) {
          await page.close().catch(() => {});
          page = null;
        }
        if (browser) {
          // 获取所有上下文并关闭它们
          const contexts = browser.contexts();
          for (const context of contexts) {
            const pages = context.pages();
            for (const p of pages) {
              await p.close().catch(() => {});
            }
            await context.close().catch(() => {});
          }

          // 注意：通过CDP连接的浏览器实例没有disconnect方法
          // 直接跳过disconnect步骤

          // 获取Chrome进程引用并终止
          const chromeProcess = (browser as any).chromeProcess;
          if (chromeProcess) {
            try {
              chromeProcess.kill('SIGTERM');
              console.log('Chrome进程已终止');
            } catch (killError) {
              console.error('终止Chrome进程失败:', killError);
            }
          }

          browser = null;
        }

        console.log('浏览器资源已完全清理');
      } catch (error) {
        console.error('清理浏览器资源时出错:', error);
      }
    };

    // 设置实例属性
    this.filePathArray = UserData.filePathArray;
    this.currentVideoIndex = 0;
    this.emit('log', {
      message: `开始发布到淘宝`,
      type: 'success',
    });

    try {
      // 更新发布记录状态为处理中
      try {
        if (this.filePathArray && this.filePathArray.length > 0) {
          // 获取第一个视频文件的路径信息
          const firstVideoPath = this.filePathArray[0];
          const currentDir = path.dirname(firstVideoPath);
          const currentDirName = path.basename(currentDir);

          // 解析目录名获取guangId
          const dirParts = currentDirName.split('---');
          if (dirParts.length >= 4) {
            const guangId = dirParts[3]; // 获取逛逛ID

            // 创建GuangProcessor实例来更新状态
            const guangProcessor = new GuangProcessor();

            // 查询待处理的记录并更新为处理中
            const pendingRecord = await guangProcessor.getPublishGuangHeRecord(
              guangId,
              firstVideoPath,
              GuangHePublishStatus.PENDING
            );

            if (pendingRecord) {
              await guangProcessor.updatePublishGuangHeRecord(
                pendingRecord.id,
                GuangHePublishStatus.PROCESSING
              );

              this.emit('log', {
                message: `更新发布记录状态为处理中 - guangId: ${guangId}`,
                type: 'info',
              });
            }
          }
        }
      } catch (statusError) {
        console.error('更新发布记录状态为处理中失败:', statusError);
        this.emit('log', {
          message: `更新发布记录状态为处理中失败: ${statusError}`,
          type: 'warning',
        });
      }

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
        this.emit('log', {
          message: `执行登录操作`,
          type: 'info',
        });
        await this.loginToTaobao(page);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      const closeBtn = await page.locator('.next-icon-close').first();

      if (await closeBtn.isVisible()) {
        await closeBtn.click({ timeout: 5000 });
        console.log('弹窗关闭成功');
        await new Promise(resolve => setTimeout(resolve, 1000));
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
        // await this.simulateHumanInput(userNameInput, UserData.guangId);
        await userNameInput.type(UserData.guangId);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 点击搜索按钮
      await page.locator('.search-view > button').nth(0).click();

      // 等待搜索结果加载
      await new Promise(resolve => setTimeout(resolve, 2000));

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
      await new Promise(resolve => setTimeout(resolve, 500));
      // 点击发视频
      await page.locator('.menu--Awalkj18 > li').first().click();
      await new Promise(resolve => setTimeout(resolve, 500));
      // 点击批量发布
      await page.locator('.next-menu-spacing-lr > ul > li').last().click();

      // 上传视频 - next-upload-dragable
      try {
        // 等待上传区域可见
        console.log('等待上传区域加载...');
        await page.waitForSelector('.next-upload-dragable', { timeout: 3000 });
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
              timeout: 5000,
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
            await new Promise(resolve => setTimeout(resolve, 10000));
            console.log('第一个视频上传等待完成');

            // 等待iframe加载完成
            console.log('等待iframe加载完成...');
            await page.waitForSelector('iframe.publish-content--Cl3CtTGD', {
              timeout: 5000,
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
                  { timeout: 5000 }
                );

                if (addVideoButton) {
                  console.log('找到"添加视频"按钮，准备点击...');

                  // 触发文件上传对话框
                  const nextUploadPromise = page.waitForEvent('filechooser', {
                    timeout: 5000,
                  });

                  await addVideoButton.click({ delay: 200, noWaitAfter: true });
                  console.log('已点击"添加视频"按钮');

                  // 选择下一个视频文件
                  const nextFileChooser = await nextUploadPromise;
                  await nextFileChooser.setFiles([validFiles[i]]);
                  console.log(`已选择第${i + 1}个视频文件进行上传`);

                  // 等待当前视频上传完成
                  console.log(`等待第${i + 1}个视频上传完成...`);
                  await new Promise(resolve => setTimeout(resolve, 10000));
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
        await page.waitForSelector(iframeSelector, { timeout: 5000 });
        // 获取iframe元素
        const iframeElement = await page.$(iframeSelector);
        let frame = null;

        if (iframeElement) {
          // 获取iframe的contentFrame
          frame = await iframeElement.contentFrame();
        }
        iframeDetection = setInterval(async () => {
          if (frame) {
            console.log('iframe已加载,开始检测关闭按钮和目标图片...');

            // 确保frame已获取
            try {
              // 检测关闭按钮是否存在
              const closeBtn = await frame.$('.baxia-dialog-close');
              // 检测目标图片是否存在（通过src精确匹配）

              // 只有当关闭按钮和目标图片同时存在时才执行关闭
              if (closeBtn) {
                const imgIframeSelector = await frame.waitForSelector(
                  'iframe#baxia-dialog-content',
                  { timeout: 5000 }
                );
                const imgIframe = await imgIframeSelector.contentFrame();
                const targetImg = await imgIframe.$(
                  `img[src="https://img.alicdn.com/imgextra/i2/O1CN010VLpQY1VWKHBQuBUQ_!!6000000002660-2-tps-222-222.png"]`
                );
                this.emit('log', {
                  message: '检测到关闭按钮',
                  type: 'info',
                });
                if (targetImg) {
                  this.emit('log', {
                    message: '检测到目标图片，执行关闭',
                    type: 'info',
                  });
                  console.log('检测到目标图片和关闭按钮，准备执行关闭');
                  await new Promise(resolve => setTimeout(resolve, 200));
                  await closeBtn.click();
                  console.log('检测到目标图片和关闭按钮，已执行关闭');
                }
              }
            } catch (err) {
              console.log('检测过程出错:', err);
            }
          }
        }, 1000); // 每1秒检测一次
        if (frame) {
          // 获取所有视频的队列
          const videoQueue = await frame.locator('.batchItemWrap').all();
          for (let i = 0; i < videoQueue.length; i++) {
            // 更新当前视频索引
            this.currentVideoIndex = i;
            const video = videoQueue[i];
            await video.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.fillVideoInfo(frame, UserData);
          }

          // 先清理定时器
          if (iframeDetection) {
            // 确保定时器存在
            console.log('iframeDetection 存在,关闭定时器');
            this.emit('log', {
              message: 'iframeDetection 存在,关闭定时器',
              type: 'info',
            });
            clearInterval(iframeDetection);
            iframeDetection = null;
          }

          await new Promise(resolve => setTimeout(resolve, 4000));

          const publishBtn = await frame
            .locator('.batch-button-area > div')
            .locator('button');

          if (await publishBtn.isVisible()) {
            console.log('点击批量发布按钮...');
            this.emit('log', {
              message: '点击批量发布按钮...',
              type: 'info',
            });
            await publishBtn.click();
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 定位滑块弹窗（使用 locator 而非直接获取元素，保持引用有效性）
            const confirmLocator = frame.locator('.baxia-dialog-content');
            let checkTimer: any = null; // 用于存储定时器，便于中途清除

            try {
              if (await confirmLocator.isVisible()) {
                console.log('检测到滑块验证弹窗，等待人工操作...');
                this.emit('log', {
                  message: '检测到滑块验证弹窗，等待人工操作...',
                  type: 'warning',
                });

                const checkInterval = 10000; // 每10秒检查一次
                let remainingTime = 300000;

                // 用 setTimeout 实现可中断的循环（替代 while）
                const checkPopup = async () => {
                  // 1. 检查 frame 是否仍有效（是否在页面的有效 iframe 列表中）
                  const allFrames = page.frames();
                  const isFrameValid = allFrames.includes(frame);
                  if (!isFrameValid) {
                    this.emit('log', {
                      message: '页面跳转，iframe 已失效，操作成功',
                      type: 'info',
                    });
                    // 清除定时器
                    clearTimeout(checkTimer);
                    checkTimer = null;
                    return;
                  }

                  // 2. 检查滑块弹窗是否仍可见（捕获可能的错误）
                  let isStillVisible;
                  try {
                    isStillVisible = await confirmLocator.isVisible();
                  } catch (err: any) {
                    console.log(
                      '滑块弹窗元素已不可访问，终止等待:',
                      err.message
                    );
                    this.emit('log', {
                      message: '滑块弹窗元素已不可访问，终止等待:',
                      type: 'error',
                    });
                    return;
                  }

                  if (!isStillVisible) {
                    console.log('滑块验证弹窗已关闭，视为成功');
                    this.emit('log', {
                      message: '滑块验证弹窗已关闭，继续执行...',
                      type: 'info',
                    });
                    // 清除定时器
                    clearTimeout(checkTimer);
                    checkTimer = null;
                    return;
                  }

                  // 超时处理
                  remainingTime -= checkInterval;
                  if (remainingTime <= 0) {
                    console.log('滑块验证超时，操作失败');
                    this.emit('log', {
                      message: '滑块验证超时，操作失败',
                      type: 'error',
                    });
                    // 清除定时器
                    clearTimeout(checkTimer);
                    checkTimer = null;
                    // 执行任务失败处理
                    await this.handleTaskFailure({ message: '滑块验证超时' });
                    return;
                  }

                  console.log(
                    `继续等待滑块验证完成，剩余时间: ${Math.ceil(
                      remainingTime / 1000
                    )}秒`
                  );
                  this.emit('log', {
                    message: `继续等待滑块验证完成，剩余时间: ${Math.ceil(
                      remainingTime / 1000
                    )}秒`,
                    type: 'info',
                  });
                  checkTimer = setTimeout(checkPopup, checkInterval);
                };

                checkTimer = setTimeout(checkPopup, checkInterval);
                await new Promise<void>(resolve => {
                  const waitInterval = setInterval(() => {
                    if (!checkTimer) {
                      clearInterval(waitInterval);
                      resolve();
                    }
                  }, 1000);
                });
              }

              this.emit('log', {
                message: '滑块验证弹窗已关闭，视为成功',
                type: 'info',
              });
              // 后续逻辑：检查发布状态（需先确认 frame 仍有效）
              const allFrames = page.frames();
              const isFrameValid = allFrames.includes(frame);
              if (isFrameValid) {
                const firstStatus = await frame
                  .locator('.batchItemStatus > div')
                  .first()
                  .textContent();

                if (firstStatus === '发布失败') {
                  this.emit('log', {
                    message: '检测到发布失败视频',
                    type: 'warning',
                  });
                  return await this.handleTaskFailure({
                    message: '检测到发布失败视频',
                  });
                }
              } else {
                console.log('iframe 已失效，跳过发布状态检查');
                this.emit('log', {
                  message: 'iframe 已失效，跳过发布状态检查',
                  type: 'warning',
                });
              }

              this.emit('log', {
                message: `已完成视频发布信息填写`,
                type: 'info',
              });
            } catch (err: any) {
              console.error('发布流程出错:', err);
              this.emit('log', {
                message: `发布流程出错: ${err.message}`,
                type: 'error',
              });
              throw err;
            } finally {
              // 清理定时器，防止内存泄漏
              if (checkTimer) clearTimeout(checkTimer);
            }
          }
        }
      } catch (describeError: any) {
        console.error('发布视频信息填写出错:', describeError.message);
        this.emit('log', {
          message: `发布视频信息填写出错: ${describeError.message}`,
          type: 'error',
        });
        throw describeError; // 重新抛出异常，让外层处理
      }

      // 使用封装的方法处理任务完成
      return await this.handleTaskCompletion();
    } catch (error: any) {
      // 使用封装的方法处理任务失败
      return await this.handleTaskFailure(error);
    } finally {
      // 无论成功还是失败，都要清理资源
      await cleanup();
    }
  }

  /**
   * 处理任务完成后的逻辑
   * @param successMessage 成功消息
   */
  private async handleTaskCompletion(
    successMessage: string = '淘宝光合平台视频发布任务处理完成'
  ) {
    // 任务完成，记录成功日志
    this.emit('log', {
      message: successMessage,
      type: 'success',
    });

    // 更新发布记录状态为已完成
    try {
      if (this.filePathArray && this.filePathArray.length > 0) {
        // 获取第一个视频文件的路径信息
        const firstVideoPath = this.filePathArray[0];
        const currentDir = path.dirname(firstVideoPath);
        const currentDirName = path.basename(currentDir);

        // 解析目录名获取guangId
        const dirParts = currentDirName.split('---');
        if (dirParts.length >= 4) {
          const guangId = dirParts[3]; // 获取逛逛ID

          // 创建GuangProcessor实例来更新状态
          const guangProcessor = new GuangProcessor();

          // 先查询对应的发布记录
          const record = await guangProcessor.getPublishGuangHeRecord(
            guangId,
            firstVideoPath,
            GuangHePublishStatus.PROCESSING
          );

          if (record) {
            // 更新状态为已完成
            await guangProcessor.updatePublishGuangHeRecord(
              record.id,
              GuangHePublishStatus.COMPLETED
            );

            this.emit('log', {
              message: `更新发布记录状态为已完成 - guangId: ${guangId}`,
              type: 'info',
            });
          } else {
            // 如果没找到处理中的记录，尝试查找待处理的记录
            const pendingRecord = await guangProcessor.getPublishGuangHeRecord(
              guangId,
              firstVideoPath,
              GuangHePublishStatus.PENDING
            );

            if (pendingRecord) {
              await guangProcessor.updatePublishGuangHeRecord(
                pendingRecord.id,
                GuangHePublishStatus.COMPLETED
              );

              this.emit('log', {
                message: `更新发布记录状态为已完成（从待处理） - guangId: ${guangId}`,
                type: 'info',
              });
            }
          }
        }
      }
    } catch (statusError) {
      console.error('更新发布记录状态失败:', statusError);
      this.emit('log', {
        message: `更新发布记录状态失败: ${statusError}`,
        type: 'warning',
      });
    }

    // 任务完成后清理目录 - 修改日期为明天，数字改为0，删除视频文件
    try {
      const currentDirectory = this.guangGuangAccountDirectories[0];
      if (currentDirectory) {
        console.log(`开始清理目录: ${currentDirectory}`);

        const dirName = path.basename(currentDirectory);
        const dirParts = dirName.split('---');

        if (dirParts.length >= 6) {
          // 1. 修改日期为当前日期的第二天
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr =
            tomorrow.getFullYear().toString() +
            String(tomorrow.getMonth() + 1).padStart(2, '0') +
            String(tomorrow.getDate()).padStart(2, '0');

          dirParts[4] = tomorrowStr; // 更新日期部分
          dirParts[5] = '0'; // 2. 将末尾数字改为0

          const newDirName = dirParts.join('---');
          const parentDir = path.dirname(currentDirectory);
          const newDirPath = path.join(parentDir, newDirName);

          // 重命名目录（修改日期和数字）
          try {
            fs.renameSync(currentDirectory, newDirPath);
            console.log(`目录重命名成功: ${dirName} -> ${newDirName}`);

            // 3. 删除目录下的视频文件（只在成功时执行）
            try {
              const files = fs.readdirSync(newDirPath);
              let deletedCount = 0;

              for (const file of files) {
                const filePath = path.join(newDirPath, file);
                const ext = path.extname(file).toLowerCase();

                if (['.mp4', '.avi', '.mov', '.mkv', '.flv'].includes(ext)) {
                  fs.unlinkSync(filePath);
                  deletedCount++;
                  console.log(`删除视频文件: ${file}`);
                }
              }

              console.log(`共删除 ${deletedCount} 个视频文件`);

              this.emit('log', {
                message: `目录清理完成: ${newDirName}，删除${deletedCount}个视频`,
                type: 'info',
              });
            } catch (deleteError) {
              console.error('删除视频文件失败:', deleteError);
              this.emit('log', {
                message: `删除视频文件失败: ${deleteError}`,
                type: 'warning',
              });
            }
          } catch (renameError) {
            console.error('目录重命名失败:', renameError);
            this.emit('log', {
              message: `目录重命名失败: ${renameError}`,
              type: 'warning',
            });
          }
        }
      }
    } catch (cleanupError) {
      console.error('目录清理操作失败:', cleanupError);
      this.emit('log', {
        message: `目录清理失败: ${cleanupError}`,
        type: 'warning',
      });
    }

    // 返回成功状态
    return {
      success: true,
      message: successMessage,
    };
  }

  /**
   * 处理任务失败后的逻辑
   * @param error 错误对象
   */
  private async handleTaskFailure(error: any) {
    const errorMsg = `发布到淘宝出错: ${error.message}`;
    console.error(errorMsg);
    this.emit('log', {
      message: errorMsg,
      type: 'error',
    });

    // 更新发布记录状态为失败
    try {
      if (this.filePathArray && this.filePathArray.length > 0) {
        // 获取第一个视频文件的路径信息
        const firstVideoPath = this.filePathArray[0];
        const currentDir = path.dirname(firstVideoPath);
        const currentDirName = path.basename(currentDir);

        // 解析目录名获取guangId
        const dirParts = currentDirName.split('---');
        if (dirParts.length >= 4) {
          const guangId = dirParts[3]; // 获取逛逛ID

          // 创建GuangProcessor实例来更新状态
          const guangProcessor = new GuangProcessor();

          // 先查询对应的发布记录
          const record = await guangProcessor.getPublishGuangHeRecord(
            guangId,
            firstVideoPath,
            GuangHePublishStatus.PROCESSING
          );

          if (record) {
            // 更新状态为失败
            await guangProcessor.updatePublishGuangHeRecord(
              record.id,
              GuangHePublishStatus.FAILED
            );

            this.emit('log', {
              message: `更新发布记录状态为失败 - guangId: ${guangId}`,
              type: 'warning',
            });
          } else {
            // 如果没找到处理中的记录，尝试查找待处理的记录
            const pendingRecord = await guangProcessor.getPublishGuangHeRecord(
              guangId,
              firstVideoPath,
              GuangHePublishStatus.PENDING
            );

            if (pendingRecord) {
              await guangProcessor.updatePublishGuangHeRecord(
                pendingRecord.id,
                GuangHePublishStatus.FAILED
              );

              this.emit('log', {
                message: `更新发布记录状态为失败（从待处理） - guangId: ${guangId}`,
                type: 'warning',
              });
            }
          }
        }
      }
    } catch (statusError) {
      console.error('更新发布记录状态失败:', statusError);
      this.emit('log', {
        message: `更新发布记录状态失败: ${statusError}`,
        type: 'warning',
      });
    }

    // 发布失败时，将目录末尾数字改为error
    try {
      if (this.filePathArray && this.filePathArray.length > 0) {
        // 获取第一个视频文件的目录路径
        const firstVideoPath = this.filePathArray[0];
        const currentDir = path.dirname(firstVideoPath);
        const currentDirName = path.basename(currentDir);

        // 解析目录名格式：A0---美瞳变色龙---美妆---4701623256---20251106---3
        const dirParts = currentDirName.split('---');
        if (dirParts.length === 6) {
          // 统一改为error
          dirParts[5] = 'e';

          const newDirName = dirParts.join('---');
          const parentDir = path.dirname(currentDir);
          const newDirPath = path.join(parentDir, newDirName);

          try {
            fs.renameSync(currentDir, newDirPath);
            this.emit('log', {
              message: `发布失败，目录重命名: ${currentDirName} -> ${newDirName}`,
              type: 'warning',
            });
          } catch (renameError) {
            console.error(`目录重命名失败: ${renameError}`);
            this.emit('log', {
              message: `目录重命名失败: ${renameError}`,
              type: 'warning',
            });
          }
        }
      }
    } catch (dirError) {
      console.error(`处理失败目录时出错: ${dirError}`);
      this.emit('log', {
        message: `处理失败目录时出错: ${dirError}`,
        type: 'warning',
      });
    }

    return {
      success: false,
      message: `操作失败: ${error.message}`,
    };
  }

  /**
   * 获取逛逛账号目录列表 - 筛选符合条件的目录
   * 目录格式：A0---美瞳变色龙---美妆---4701623256---20251106---0
   * 筛选条件：日期小于等于今天，且最后一个数字大于等于3
   */
  private getGuangGuangAccountDirectories(): string[] {
    try {
      const monitorDirectory =
        '\\\\192.168.31.99\\影视存储\\逛逛客户端\\逛逛账号';

      // 检查目录是否存在
      if (!fs.existsSync(monitorDirectory)) {
        console.log(`目录不存在: ${monitorDirectory}`);
        return [];
      }

      const items = fs.readdirSync(monitorDirectory);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // 设置为今天的开始时间

      const validDirectories: string[] = [];

      for (const item of items) {
        const fullPath = path.join(monitorDirectory, item);

        // 检查是否是目录
        if (!fs.statSync(fullPath).isDirectory()) {
          continue;
        }

        // 解析目录名格式：A0---美瞳变色龙---美妆---4701623256---20251106---0
        const parts = item.split('---');
        if (parts.length !== 6) {
          continue;
        }

        // 获取日期部分（第5个元素，索引4）和最后一个数字（第6个元素，索引5）
        const dateStr = parts[4];
        const lastPart = parts[5];

        // 检查日期格式是否为YYYYMMDD
        if (!/^\d{8}$/.test(dateStr)) {
          continue;
        }

        // 解析日期
        const year = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10) - 1; // 月份从0开始
        const day = parseInt(dateStr.substring(6, 8), 10);

        const dirDate = new Date(year, month, day);

        // 检查条件：日期小于等于今天，且最后一个部分是数字且大于等于3，忽略字母e结尾的目录
        const isDateValid = dirDate <= today;
        let isValid = false;
        let lastNumber = 0;

        if (lastPart === 'e') {
          // 字母e结尾的目录明确忽略，跳过处理
          console.log(`跳过e结尾的目录: ${item}`);
          continue;
        } else {
          // 检查是否为数字且大于等于3
          lastNumber = parseInt(lastPart, 10);
          isValid = !isNaN(lastNumber) && lastNumber >= 3;
        }

        if (!isDateValid || !isValid) {
          continue;
        }

        // 检查目录下的视频数量
        try {
          const files = fs.readdirSync(fullPath);
          const videoFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.avi', '.mov', '.mkv', '.flv'].includes(ext);
          });

          const actualVideoCount = videoFiles.length;
          console.log(`目录 ${item} 下的视频数量: ${actualVideoCount}`);

          // 如果视频数量小于3，跳过此目录
          if (actualVideoCount < 3) {
            console.log(`目录 ${item} 视频数量不足3个，跳过`);
            continue;
          }

          let finalPath = fullPath;

          // 如果实际视频数量与目录最后的数字不符，重命名目录（忽略末尾为e或error的失败目录）
          if (
            actualVideoCount !== lastNumber &&
            lastPart !== 'e' &&
            lastPart !== 'error'
          ) {
            const newParts = [...parts];
            newParts[5] = actualVideoCount.toString();
            const newDirName = newParts.join('---');
            const newPath = path.join(monitorDirectory, newDirName);

            try {
              fs.renameSync(fullPath, newPath);
              console.log(`重命名目录: ${item} -> ${newDirName}`);
              finalPath = newPath;
            } catch (renameError) {
              console.error(`重命名目录失败: ${item}`, renameError);
              // 如果重命名失败，继续使用原路径
              finalPath = fullPath;
            }
          }

          // 将处理后的目录加入结果列表
          validDirectories.push(finalPath);
          console.log(`添加目录到队列: ${finalPath}`);
        } catch (videoCheckError) {
          console.error(`检查目录视频数量失败: ${item}`, videoCheckError);
          continue;
        }
      }

      console.log(`找到 ${validDirectories.length} 个符合条件的目录`);
      return validDirectories;
    } catch (error) {
      console.error('读取逛逛账号目录失败:', error);
      return [];
    }
  }

  /**
   * 清空逛逛账号目录数组（置空等待处理）
   */
  private clearGuangGuangAccountDirectories(): void {
    // 这个方法可以根据实际需求来实现清空逻辑
    // 例如可以移动目录、重命名、或者只是返回空数组
    console.log('清空逛逛账号目录数组，置空等待处理');
  }

  /**
   * 检测并更新目录数组
   */
  public async checkAndUpdateDirectories(): Promise<void> {
    try {
      console.log('开始检测逛逛账号目录...');
      const newDirectories = this.getGuangGuangAccountDirectories();

      // 检查是否有新目录
      const hasNewDirectories =
        newDirectories.length > this.guangGuangAccountDirectories.length;

      if (hasNewDirectories) {
        console.log(`发现新目录，更新目录数组: ${newDirectories.length} 个`);
        this.guangGuangAccountDirectories = newDirectories;
      }

      if (this.guangGuangAccountDirectories.length > 0) {
        await this.processDirectoryQueue();
      }
    } catch (error) {
      console.error('检测目录时出错:', error);
    }
  }

  /**
   * 处理队列中的目录
   */
  public async processDirectoryQueue(): Promise<void> {
    // 防止并发处理
    if (this.isProcessingQueue) {
      console.log('队列正在处理中，跳过本次处理');
      return;
    }

    if (this.guangGuangAccountDirectories.length === 0) {
      console.log('队列为空，无需处理');
      return;
    }

    this.isProcessingQueue = true;
    console.log(
      `开始处理队列，当前队列长度: ${this.guangGuangAccountDirectories.length}`
    );

    try {
      // 只处理第一个目录
      const directory = this.guangGuangAccountDirectories[0];
      console.log(`处理目录: ${directory}`);

      try {
        // 获取目录名
        const dirName = path.basename(directory);
        console.log(`目录名: ${dirName}`);
        const dirParts = dirName.split('---');

        // 获取guangId（目录名按---分割的下标3）
        const guangId = dirParts[3] || '';
        console.log(`guangId: ${guangId}`);

        // 获取该目录下的所有视频文件
        const videoFiles = fs
          .readdirSync(directory)
          .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.avi', '.mov', '.mkv', '.flv'].includes(ext);
          })
          .map(file => path.join(directory, file));

        console.log(`找到视频文件数量: ${videoFiles.length}`);
        console.log(
          `视频文件列表: ${videoFiles.map(f => path.basename(f)).join(', ')}`
        );

        // 检查视频数量，小于3个不处理
        if (videoFiles.length < 3) {
          console.log(
            `目录 ${directory} 中视频数量(${videoFiles.length})小于3个，跳过处理`
          );

          // 修改目录名，将最后一个数字改为视频数量
          if (dirParts.length >= 6) {
            const newDirName =
              dirParts.slice(0, 5).join('---') + '---' + videoFiles.length;
            const newDirPath = path.join(path.dirname(directory), newDirName);

            try {
              fs.renameSync(directory, newDirPath);
              console.log(`目录重命名成功: ${dirName} -> ${newDirName}`);
            } catch (renameError) {
              console.error(`目录重命名失败: ${renameError}`);
            }
          }

          // 从队列中移除该目录
          this.guangGuangAccountDirectories.shift();
          return;
        }

        if (videoFiles.length === 0) {
          console.log(`目录 ${directory} 中没有找到视频文件`);
          this.emit('log', {
            type: 'info',
            message: `目录 ${directory} 中没有找到视频文件`,
          });
          // 从队列中移除该目录
          this.guangGuangAccountDirectories.shift();
          return;
        }

        // 获取所有视频的productId列表，用于后续匹配
        const productIds: string[] = [];
        const productNames: string[] = [];

        videoFiles.forEach(videoFile => {
          const videoFileName = path.basename(videoFile);
          const videoFileParts = videoFileName.split('---');
          const productId = videoFileParts[4] || '';
          const productName = videoFileParts[2] || '';

          if (productId && !productIds.includes(productId)) {
            productIds.push(productId);
          }
          if (productName && !productNames.includes(productName)) {
            productNames.push(productName);
          }
        });

        console.log(`商品ID列表: ${productIds.join(', ')}`);
        console.log(`商品名称列表: ${productNames.join(', ')}`);

        // 读取视频描述文件 - 为每个商品ID读取对应的描述文件
        let videoDescriptions: string[] = [];
        let videoTags: string[] = [''];
        let topics: string[] = [''];
        const usedDescriptionsMap = new Map<string, number[]>(); // 记录每个商品ID已使用的描述索引

        try {
          // 为每个视频获取对应的商品描述
          for (let i = 0; i < videoFiles.length; i++) {
            const videoFile = videoFiles[i];
            const videoFileName = path.basename(videoFile);
            const videoFileParts = videoFileName.split('---');
            const currentProductId = videoFileParts[4] || '';
            const currentProductName = videoFileParts[2] || '';

            if (!currentProductId) {
              videoDescriptions.push(currentProductName);
              continue;
            }

            const descriptionFilePath = `\\\\192.168.31.99\\影视存储\\逛逛客户端\\视频标题\\${currentProductId}_gg.json`;
            console.log(`视频 ${i} 尝试读取描述文件: ${descriptionFilePath}`);

            if (fs.existsSync(descriptionFilePath)) {
              const descriptionData = JSON.parse(
                fs.readFileSync(descriptionFilePath, 'utf-8')
              );
              console.log(
                `商品 ${currentProductId} 描述文件包含 ${descriptionData.length} 条描述`
              );

              if (
                Array.isArray(descriptionData) &&
                descriptionData.length > 0
              ) {
                // 获取该商品已使用的描述索引
                const usedIndexes =
                  usedDescriptionsMap.get(currentProductId) || [];

                // 找到第一个未使用的描述
                let availableIndex = -1;
                for (let j = 0; j < descriptionData.length; j++) {
                  if (!usedIndexes.includes(j)) {
                    availableIndex = j;
                    break;
                  }
                }

                if (availableIndex !== -1) {
                  const description = descriptionData[availableIndex];

                  // 解析描述格式：开头匹配“数字+下划线”（如20251118_），后续内容到#号为止
                  const descMatch = description.match(/^(\d+_)([^#]+)/);
                  if (descMatch) {
                    const cleanDesc = descMatch[2].trim(); // 提取下划线后、#号前的内容
                    videoDescriptions.push(cleanDesc);
                    console.log(
                      `视频 ${i} 使用商品 ${currentProductId} 的描述: ${cleanDesc}`
                    );

                    // 第一个视频提取标签（逻辑不变）
                    if (i === 0) {
                      const tagMatches = description.match(/#([^#]+)#/g);
                      if (tagMatches && tagMatches.length >= 2) {
                        videoTags = tagMatches
                          .slice(0, 2)
                          .map((tag: string) => tag.replace(/#/g, ''));
                      }
                    }
                  } else {
                    // 不符合上述格式时，简化处理（仅要求开头是“数字+下划线”，截取后续前28位）
                    const startMatch = description.match(/^(\d+_)(.+)/);
                    if (startMatch) {
                      const shortDesc = startMatch[2].substring(0, 28).trim();
                      videoDescriptions.push(shortDesc);
                      console.log(
                        `视频 ${i} 使用商品 ${currentProductId} 的简化描述: ${shortDesc}`
                      );
                    }
                  }
                }
              } else {
                console.log(
                  `商品 ${currentProductId} 描述文件为空，使用商品名称: ${currentProductName}`
                );
                videoDescriptions.push(currentProductName);
              }
            } else {
              console.log(
                `商品 ${currentProductId} 描述文件不存在，使用商品名称: ${currentProductName}`
              );
              videoDescriptions.push(currentProductName);
            }
          }
        } catch (descError) {
          console.error('读取视频描述文件失败:', descError);
          // 出错时用商品名称填充剩余位置
          while (videoDescriptions.length < videoFiles.length) {
            const videoFile = videoFiles[videoDescriptions.length];
            const videoFileName = path.basename(videoFile);
            const videoFileParts = videoFileName.split('---');
            const currentProductName = videoFileParts[2] || '';
            videoDescriptions.push(currentProductName);
          }
        }

        // 如果没有获取到描述，使用空描述数组
        if (videoDescriptions.length === 0) {
          videoDescriptions = new Array(videoFiles.length).fill('');
          console.log('没有获取到视频描述，使用空描述');
        }

        // 如果没有有效的标签，尝试从config.json获取
        if (videoTags.length === 0 || videoTags[0] === '标签') {
          const configPath = path.join(directory, 'config.json');
          try {
            if (fs.existsSync(configPath)) {
              const configData = JSON.parse(
                fs.readFileSync(configPath, 'utf-8')
              );

              if (
                configData.tags &&
                Array.isArray(configData.tags) &&
                configData.tags.length > 0
              ) {
                videoTags = configData.tags.slice(0, 2); // 取前两个标签
              }

              if (
                configData.topics &&
                Array.isArray(configData.topics) &&
                configData.topics.length > 0
              ) {
                topics = configData.topics;
              }
            }
          } catch (configError) {
            console.error('读取config.json失败:', configError);
          }
        }

        console.log(`videoTags: ${videoTags}`);
        console.log(`topics数量: ${topics.length}`);
        console.log(`videoDescriptions数量: ${videoDescriptions.length}`);

        // 设置guangCatalogue（目录名）
        const guangCatalogue = dirParts.join('---');
        console.log(`guangCatalogue: ${guangCatalogue}`);

        const UserData = {
          filePathArray: videoFiles,
          guangId: guangId,
          videoTags: videoTags,
          topic: topics, // 改为数组
          videoDescription: videoDescriptions, // 改为数组
          guangCatalogue: guangCatalogue,
          productIds, // 使用商品ID列表
          productNames, // 使用商品名称列表
        };

        console.log('UserData参数:', JSON.stringify(UserData, null, 2));
        // this.emit('log', {
        //   message: `商品ID列表: ${productIds.join(', ')}`,
        //   type: 'info',
        // });
        // this.emit('log', {
        //   message: `商品名称列表: ${productNames.join(', ')}`,
        //   type: 'info',
        // });
        // this.emit('log', {
        //   message: `视频描述数量: ${videoDescriptions.length}`,
        //   type: 'info',
        // });
        // this.emit('log', {
        //   message: `UserData参数: ${JSON.stringify(UserData, null, 2)}`,
        //   type: 'info',
        // });
        // 调用 GuangheTaobaoIssue 处理目录
        await this.GuangheTaobaoIssue(UserData);

        // 处理完成后从数组中移除第一个目录
        this.guangGuangAccountDirectories.shift();
        console.log(
          `目录处理完成，剩余目录数量: ${this.guangGuangAccountDirectories.length}`
        );
      } catch (error) {
        console.error(`处理目录失败: ${directory}，错误信息:`, error);
        // 处理失败也从队列中移除，避免死循环
        this.guangGuangAccountDirectories.shift();
      }
    } catch (error) {
      console.error('处理队列时出错:', error);
    } finally {
      this.isProcessingQueue = false;
      console.log('队列处理结束');
    }
  }
}

export default GuangheTaobao;

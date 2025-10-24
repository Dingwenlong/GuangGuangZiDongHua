import config from '@config/index';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { winURL, loadingURL, getPreloadFile } from '@main/config/static-path';
import {
  mainWindowConfig,
  loginWindowConfig,
  loadWindowConfig,
} from '../config/window-create';
import { useProcessException } from '@main/hooks/exception-hook';
import {
  registerIpcHandlers,
  unregisterIpcHandlers,
} from '@main/services/ipc-main';
import {
  ipcCustomLoginHandlers,
  ipcCustomMainHandlers,
} from '@main/services/ipc-custom-handle';
import authManager from '@main/services/auth-manager';

class MainInit {
  public winURL: string = '';
  public chartURL: string = '';
  public loadWindow: BrowserWindow | null = null;
  public mainWindow: BrowserWindow | null = null;
  public loginWindow: BrowserWindow | null = null;
  private childProcessGone: any = null;
  private mainWindowGone: any = null;

  constructor() {
    const { childProcessGone, mainWindowGone } = useProcessException();
    this.winURL = winURL;
    this.chartURL = loadingURL;
    this.childProcessGone = childProcessGone;
    this.mainWindowGone = mainWindowGone;
  }
  // 主窗口函数
  async createMainWindow() {
    this.mainWindow = await this.createWindow(
      mainWindowConfig,
      this.winURL,
      true,
      win => {
        win.show();
        if (config.UseStartupChart && this.loadWindow)
          this.loadWindow.destroy();
      }
    );
    // 注册主窗体专属的IPC事件
    registerIpcHandlers(ipcCustomMainHandlers(this));
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      unregisterIpcHandlers(ipcCustomMainHandlers(this));
    });
  }
  // 登录窗口函数
  async createLoginWindow() {
    if (config.IgnoreLogin || (await authManager.isLoggedIn()))
      return await this.createMainWindow();

    this.loginWindow = await this.createWindow(
      loginWindowConfig,
      this.winURL,
      false,
      win => {
        win.show();
        if (config.UseStartupChart && this.loadWindow)
          this.loadWindow.destroy();
      }
    );
    // 注册登录窗体专属的IPC事件
    registerIpcHandlers(ipcCustomLoginHandlers(this));
    this.loginWindow.on('closed', () => {
      this.loginWindow = null;
      unregisterIpcHandlers(ipcCustomLoginHandlers(this));
    });
  }
  // 加载窗口函数
  async loadingWindow(loadingURL: string) {
    this.loadWindow = await this.createWindow(
      loadWindowConfig,
      this.chartURL,
      false
    );
    this.loadWindow.show();
    // 延迟两秒可以根据情况后续调快，= =，就相当于个，sleep吧，就那种。 = =。。。
    setTimeout(() => {
      this.createLoginWindow();
    }, 1500);
  }
  // 通用创建窗口函数
  async createWindow(
    options: BrowserWindowConstructorOptions,
    url: string,
    openDev: boolean,
    onReadyToShow?: (win: BrowserWindow) => void // 添加回调参数
  ) {
    options.webPreferences!.preload = getPreloadFile('preload');
    const newWindow = new BrowserWindow(options);

    // 在 loadURL 之前监听 ready-to-show 事件
    if (onReadyToShow) {
      newWindow.once('ready-to-show', () => onReadyToShow(newWindow));
    }
    await newWindow.loadURL(url);

    // 不知道什么原因，反正就是这个窗口里的页面触发了假死时执行
    this.mainWindowGone(newWindow);
    // 新的gpu崩溃检测，详细参数详见：http://www.electronjs.org/docs/api/app
    this.childProcessGone(newWindow);
    // 开发模式下自动开启devtools
    if (openDev && process.env.NODE_ENV === 'development') {
      newWindow.webContents.openDevTools({
        mode: 'undocked',
        activate: true,
      });
    }
    return newWindow;
  }
  // 初始化窗口函数
  async initWindow() {
    if (config.UseStartupChart) {
      return await this.loadingWindow(this.chartURL);
    } else {
      return await this.createLoginWindow();
    }
  }
}
export default MainInit;

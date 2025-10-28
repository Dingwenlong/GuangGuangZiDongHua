import { type BrowserWindowConstructorOptions } from 'electron';
import config from '@config/index';

export const mainWindowConfig: BrowserWindowConstructorOptions = {
  titleBarOverlay: {
    height: 40,
    color: '#001428',
    symbolColor: '#fff',
  },
  titleBarStyle: config.IsUseSysTitle ? 'default' : 'hidden',
  backgroundColor: '#001428',
  width: 1700,
  height: 800,
  minWidth: 1366,
  useContentSize: true,
  autoHideMenuBar: true,
  show: false,
  frame: config.IsUseSysTitle,
  webPreferences: {
    nodeIntegration: false, // 推荐保持 false，出于安全考虑
    contextIsolation: true, // 推荐保持 true，出于安全考虑
    sandbox: false,
    webSecurity: true,
    // 如果是开发模式可以使用devTools
    // devTools: process.env.NODE_ENV === 'development',
    // 在macos中启用橡皮动画
    scrollBounce: process.platform === 'darwin',
  },
};

export const loginWindowConfig: BrowserWindowConstructorOptions = {
  titleBarOverlay: false,
  titleBarStyle: 'hidden',
  backgroundColor: '#ffffff',
  width: 400,
  height: 600,
  resizable: false,
  useContentSize: true,
  autoHideMenuBar: true,
  show: false,
  frame: false,
  webPreferences: {
    nodeIntegration: false, // 推荐保持 false，出于安全考虑
    contextIsolation: true, // 推荐保持 true，出于安全考虑
    sandbox: false,
    webSecurity: true,
    // 如果是开发模式可以使用devTools
    // devTools: process.env.NODE_ENV === "development",
    // 在macos中启用橡皮动画
    scrollBounce: process.platform === 'darwin',
  },
};

export const loadWindowConfig: BrowserWindowConstructorOptions = {
  width: 400,
  height: 600,
  frame: false,
  skipTaskbar: true,
  transparent: true,
  resizable: false,
  // alwaysOnTop: true,
  center: true,
  useContentSize: true,
  autoHideMenuBar: true,
  webPreferences: {
    sandbox: true,
    nodeIntegration: false, // 推荐保持 false，出于安全考虑
    contextIsolation: true, // 推荐保持 true，出于安全考虑
    experimentalFeatures: true,
  },
};

export const childWindowConfig: BrowserWindowConstructorOptions = {
  titleBarOverlay: {
    height: 40,
    color: '#001428',
    symbolColor: '#fff',
  },
  titleBarStyle: config.IsUseSysTitle ? 'default' : 'hidden',
  backgroundColor: '#001428',
  height: 595,
  useContentSize: true,
  width: 1140,
  autoHideMenuBar: true,
  minWidth: 842,
  frame: config.IsUseSysTitle,
  show: false,
  webPreferences: {
    nodeIntegration: false, // 推荐保持 false，出于安全考虑
    contextIsolation: true, // 推荐保持 true，出于安全考虑
    sandbox: false,
    webSecurity: true,
    // devTools: process.env.NODE_ENV === 'development',
    scrollBounce: process.platform === 'darwin',
  },
};

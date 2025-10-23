'use strict';

import { app, session, BrowserWindow } from 'electron';
import InitWindow from './services/window-manager';
import { useDisableButton } from './hooks/disable-button-hook';
import { useProcessException } from './hooks/exception-hook';
import { useMenu } from './hooks/menu-hook';
import { registerIpcHandlers } from './services/ipc-main';
import { ipcMainHandlers } from './services/ipc-main-handle';
import { downloadIpcHandlers } from './services/download-file';
import { hotUpdateIpcHandlers } from './services/check-update';
import { hotUpdaterIpcHandlers } from './services/hot-updater';
import { ipcCustomGlobalHandlers } from '@main/services/ipc-custom-handle';

function onAppReady() {
  const { disableF12 } = useDisableButton();
  const { renderProcessGone } = useProcessException();
  const { createMenu } = useMenu();
  let mainInit: InitWindow;
  disableF12();
  renderProcessGone();
  registerIpcHandlers(ipcMainHandlers);
  registerIpcHandlers(downloadIpcHandlers);
  registerIpcHandlers(hotUpdateIpcHandlers);
  registerIpcHandlers(hotUpdaterIpcHandlers);
  createMenu();
  mainInit = new InitWindow();
  mainInit.initWindow();
  registerIpcHandlers(ipcCustomGlobalHandlers(mainInit));
  if (process.env.NODE_ENV === 'development') {
    const { VUEJS_DEVTOOLS } = require('electron-devtools-vendor');
    session.defaultSession.loadExtension(VUEJS_DEVTOOLS, {
      allowFileAccess: true,
    });
    console.log('已安装: vue-devtools');
  }
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainInit.initWindow();
    }
  });
}

app.whenReady().then(onAppReady);
// 由于9.x版本问题，需要加入该配置关闭跨域问题
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

app.on('window-all-closed', () => {
  // 所有平台均为所有窗口关闭就退出软件
  app.quit();
});
app.on('browser-window-created', () => {
  console.log('window-created');
});

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.removeAsDefaultProtocolClient('electron-vue-template');
    console.log('由于框架特殊性开发环境下无法使用');
  }
} else {
  app.setAsDefaultProtocolClient('electron-vue-template');
}

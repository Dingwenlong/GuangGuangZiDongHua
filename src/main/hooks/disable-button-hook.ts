import { BrowserWindow, globalShortcut } from 'electron';

export const useDisableButton = () => {
  const disableF12 = () => {
    globalShortcut.register('f12', () => {
      console.log('用户试图启动控制台');
    });

    globalShortcut.register('Ctrl+Shift+F1', () => {
      const win = BrowserWindow.getFocusedWindow();
      win &&
        win.webContents.openDevTools({
          mode: 'undocked',
          activate: true,
        });
    });
  };
  return {
    disableF12,
  };
};

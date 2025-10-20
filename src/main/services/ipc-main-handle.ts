import { dialog, BrowserWindow, app } from "electron";
import { winURL } from "../config/static-path";
import config from "@config/index";
import { webContentSend } from "./web-content-send";
import { childWindowConfig } from "../config/window-create";
import InitWindow from "../services/window-manager";
import fs from 'fs';
import path from "path";

type openingWinArray = {
  winId: string;
  win: BrowserWindow;
}

let winArray: openingWinArray[] = [];
export const ipcMainHandlers: IpcHandler[] = [
  {
    channel: "OpenWin",
    handler: async (_, arg: { winId: string; url: any; IsPay: any; PayUrl: string; sendData: unknown; }) => {
      let childWin = winArray.find(x => x.winId == arg.winId)?.win;
      if(childWin) {
        if(!childWin.isDestroyed()) {
          childWin.show();
          return;
        }
        winArray = winArray.filter(x => x.winId != arg.winId);
      }

      childWin = await new InitWindow().createWindow(
        childWindowConfig,
        winURL + `#${arg.url}`,
        false,
        (win) => {
          // dom-ready之后显示界面
          win.show();
        }
      );
      childWin.once("ready-to-show", () => {
        childWin.show();
        if (arg.IsPay) {
          const testUrl = setInterval(() => {
            const Url = childWin.webContents.getURL();
            if (Url.includes(arg.PayUrl)) {
              childWin.close();
            }
          }, 1200);
          childWin.on("close", () => {
            clearInterval(testUrl);
          });
        }
      });
      childWin.once("show", () => {
        webContentSend.SendDataTest(childWin.webContents, arg.sendData);
      });
      winArray.push({ winId: arg.winId, win: childWin })
    },
  },
  {
    channel: "CloseWin",
    handler: (event) => {
      BrowserWindow.fromWebContents(event.sender)?.close();
    },
  },
  {
    channel: "IsUseSysTitle",
    handler: async () => config.IsUseSysTitle,
  },
  {
    channel: "AppClose",
    handler: () => {
      app.quit();
    },
  },
  {
    channel: "AppRelaunch",
    handler: () => {
      app.relaunch();
    },
  },
  {
    channel: "ReloadWin",
    handler: () => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (win && !win.isDestroyed()) win.reload();
      });
    },
  },
  {
    channel: "OpenMessageBox",
    handler: async (event, arg: { type: any; title: any; buttons: any; message: any; noLink: any; }) => {
      const res = await dialog.showMessageBox(
        BrowserWindow.fromWebContents(event.sender)!,
        {
          type: arg.type || "info",
          title: arg.title || "",
          buttons: arg.buttons || [],
          message: arg.message || "",
          noLink: arg.noLink || true,
        }
      );
      return res;
    },
  },
  {
    channel: "OpenErrorbox",
    handler: (_, arg: { title: string; message: string; }) => {
      dialog.showErrorBox(arg.title, arg.message);
    },
  },
  {
    channel: "SelectDirectory",
    handler: async (event) => {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
        title: '请选择项目文件夹',
        properties: [
          'openDirectory',
          'createDirectory', // 允许创建新文件夹
          'promptToCreate' // 如果路径不存在，提示创建
        ],
        message: '请选择文件夹',
        buttonLabel: '选择'
      });
      return result.canceled ? null : result.filePaths[0];
    },
  },
  {
    channel: "CreateDirectory",
    handler: async (_, arg: { dirPath: string, dirName: string }) => {
      try {
        const targetDir = path.join(arg.dirPath, arg.dirName);
        console.log('targetDir', targetDir)
        await fs.promises.mkdir(targetDir, {
            recursive: true
        });
        return { success: true, path: targetDir };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  },
  {
    channel: "GetAppVersion",
    handler: () => app.getVersion(),
  },
];

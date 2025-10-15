import { dialog, BrowserWindow, app } from "electron";
import { winURL } from "../config/static-path";
import config from "@config/index";
import { webContentSend } from "./web-content-send";
import { childWindowConfig } from "../config/window-create";
import InitWindow from "../services/window-manager";

type openningWinArray = {
  winId: string;
  win: BrowserWindow;
}

let winArray: openningWinArray[] = [];
export const ipcMainHandlers = [
  {
    channel: "OpenWin",
    handler: async (_: Electron.IpcMainEvent, arg: { winId: string; url: any; IsPay: any; PayUrl: string; sendData: unknown; }) => {
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
    handler: (event: Electron.IpcMainEvent, arg: any) => {
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
    handler: async (event: Electron.IpcMainEvent, arg: { type: any; title: any; buttons: any; message: any; noLink: any; }) => {
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
    handler: (event: any, arg: { title: string; message: string; }) => {
      dialog.showErrorBox(arg.title, arg.message);
    },
  },
  {
    channel: "GetAppVersion",
    handler: () => app.getVersion(),
  },
];

import type MainInit from "./window-manager";
import authManager from "./auth-manager";
import workbenchManager from "./workbench-manager";
import { runWatermarkRemoval, checkLoginStatus } from "./playwright";
import config from "@config/index";
import { BrowserWindow } from "electron";
import VideoProcessor from "./video-processor";

/**
 * 自定义全局
 * @param mainInit
 * @returns
 */
export const ipcCustomGlobalHandlers = (
  mainInit: MainInit
): IpcHandler[] => {
  return [
    {
      channel: "GetLoginState",
      handler: async () => config.IgnoreLogin || await authManager.isLoggedIn(),
    },
    {
      channel: "OpenDevTools",
      handler: async (event) => {
        event.sender?.openDevTools({
          mode: "undocked",
          activate: true,
        });
      },
    }
  ];
};

/**
 * 自定义登录
 * @param mainInit
 * @returns
 */
export const ipcCustomLoginHandlers = (
  mainInit: MainInit
): IpcHandler[] => {
  return [
    {
      channel: "LoginSuccess",
      handler: async (
        _,
        arg: { userData: any; token: any; refreshToken: any }
      ) => {
        const { userData, token, refreshToken } = arg;
        await authManager.setLoginState(userData, token, refreshToken);

        BrowserWindow.getAllWindows().forEach(win => {
          win.close();
        })
        await mainInit.createMainWindow();
      },
    }
  ];
};

let videoProcessor: VideoProcessor;

/**
 * 自定义主窗口
 * @param mainInit
 * @returns
 */
export const ipcCustomMainHandlers = (
  mainInit: MainInit
): IpcHandler[] => {
  return [
    {
      channel: "Test",
      handler: () => {
        // authManager.clearLoginState();
      },
    },
    {
      channel: "Logout",
      handler: async () => {
        await authManager.clearLoginState();

        BrowserWindow.getAllWindows().forEach(win => {
          win.close();
        })
        await mainInit.createLoginWindow();
      },
    },
    {
      channel: "GetLoginUserInfo",
      handler: async () => {
        return await authManager.getUserInfo();
      },
    },
    {
      channel: "GetAuthInfo",
      handler: async () => {
        return await authManager.getAuthInfo();
      },
    },
    {
      channel: "RunWatermarkRemoval",
      handler: async (_, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        return await runWatermarkRemoval(filePath, targetDir);
      },
    },
    {
      channel: "CheckLoginStatus",
      handler: async () => {
        return await checkLoginStatus();
      },
    },
    {
      channel: "UpdateWorkbenchData",
      handler: async (_, arg: any) => {
        return await workbenchManager.updateData(arg);
      },
    },
    {
      channel: "GetWorkbenchData",
      handler: async () => {
        return await workbenchManager.getInfo();
      },
    },
    {
      channel: "StartMonitoring",
      handler: async (_, directory: string) => {
        if (videoProcessor) {
          videoProcessor.stop();
        }

        videoProcessor = new VideoProcessor(directory);
        videoProcessor.on('status', (data) => {
          mainInit.mainWindow!.webContents.send('StatusUpdate', data);
        });
        videoProcessor.on('log', (data) => {
          mainInit.mainWindow!.webContents.send('LogUpdate', data);
        });

        videoProcessor.start();
        return { success: true };
      },
    },
    {
      channel: "StopMonitoring",
      handler: async () => {
        if (videoProcessor) {
          videoProcessor.stop();
          return { success: true };
        }
        return { success: false };
      },
    }
  ];
};

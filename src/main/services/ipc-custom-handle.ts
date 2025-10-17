import type MainInit from "./window-manager";
import authManager from "./auth-manager";
import workbenchManager from "./workbench-manager";
import { runWatermarkRemoval, checkLoginStatus } from "./playwright";
import config from "@config/index";
import { BrowserWindow } from "electron";
import VideoProcessor from "./video-processor";
import DirectoryMonitor from "./directory-monitor";
import { webContentSend } from "./web-content-send";

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

let videoProcessor: VideoProcessor | null = null;
let dirMonitor: DirectoryMonitor | null = null;

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
      channel: "StartMonitoringDirectory",
      handler: async (event, directory: string) => {
        if (dirMonitor) {
          dirMonitor.stop();
        }

        dirMonitor = new DirectoryMonitor(directory, {
          maxDepth: 3,           // 监控深度
          updateInterval: 30000, // 30秒更新一次
          debounceDelay: 500     // 500ms防抖延迟
        });
        dirMonitor.on('directoryStructure', ({ root, structure }) => {
          if(mainInit.mainWindow)
            webContentSend.MonitoringDirectoryCallback(mainInit.mainWindow.webContents, { root, structure });
        });
        dirMonitor.on('log', ({ message, type }) => {
          if(mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, { message, type });
        });

        dirMonitor.start();
        return { success: true };
      },
    },
    {
      channel: "StopMonitoringDirectory",
      handler: async () => {
        if (dirMonitor) {
          dirMonitor.stop();
          return { success: true };
        }
        return { success: false };
      },
    },
    {
      channel: "StartMonitoringVideo",
      handler: async (event, directory: string) => {
        if (videoProcessor) {
          videoProcessor.stop();
        }

        videoProcessor = new VideoProcessor(directory);
        videoProcessor.on('status', (data) => {
          if(mainInit.mainWindow)
            webContentSend.MonitoringVideoStatusUpdate(mainInit.mainWindow.webContents, data);
        });
        videoProcessor.on('log', ({ message, type }) => {
          if(mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, { message, type });
        });

        videoProcessor.start();
        return { success: true };
      },
    },
    {
      channel: "StopMonitoringVideo",
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

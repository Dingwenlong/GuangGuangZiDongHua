import type MainInit from "./window-manager";
import authManager from "./auth-manager";
import config from "@config/index";
import { BrowserWindow } from "electron";

export const ipcCustomGlobalHandlers = (
  mainInit: MainInit
) => {
  return [
    {
      channel: "GetLoginState",
      handler: async () => config.IgnoreLogin || await authManager.isLoggedIn(),
    },
    {
      channel: "OpenDevTools",
      handler: async (event: Electron.IpcMainEvent) => {
        event.sender?.openDevTools({
          mode: "undocked",
          activate: true,
        });
      },
    }
  ];
};

export const ipcCustomLoginHandlers = (
  mainInit: MainInit
) => {
  return [
    {
      channel: "LoginSuccess",
      handler: async (
        _: any,
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

export const ipcCustomMainHandlers = (
  mainInit: MainInit
) => {
  return [
    {
      channel: "Test",
      handler: () => {
        authManager.clearLoginState();
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
  ];
};

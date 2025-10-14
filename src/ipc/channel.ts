/**
 * 这个文件是定义IPC通道的事件监听
 * 总的来说，IpcMainEventListener 和 IpcRendererEventListener 无需理解，这俩只是类型
 * IpcChannelMainClass 和 IpcChannelRendererClass 是主进程和渲染进程的IPC通道事件监听
 */

import type { ProgressInfo } from "electron-updater";
import type { UserData, Auth } from "@main/services/auth-manager";

/**
 * 主进程的IPC通道事件监听
 */
export interface IpcMainEventListener<Send = void, Receive = void> {
  /**
   * 主进程监听事件
   */
  ipcMainHandle: Send extends void
    ? (event: Electron.IpcMainInvokeEvent) => Receive | Promise<Receive>
    : (
        event: Electron.IpcMainInvokeEvent,
        args: Send
      ) => Receive | Promise<Receive>;
  /**
   * 渲染进程给主进程发送消息
   */
  ipcRendererInvoke: Send extends void
    ? () => Promise<Receive>
    : (args: Send) => Promise<Receive>;
}

/**
 * 渲染进程的IPC通道事件监听
 */
export interface IpcRendererEventListener<Send = void> {
  /**
   * 渲染进程监听事件
   */
  ipcRendererOn: Send extends void
    ? (event: Electron.IpcRendererEvent) => void
    : (event: Electron.IpcRendererEvent, args: Send) => void;
  /**
   * 主进程给渲染进程发送消息
   */
  webContentSend: Send extends void
    ? (webContents: Electron.WebContents) => void
    : (webContents: Electron.WebContents, args: Send) => void;
}

/**
 * 主进程的IPC通道事件
 * 给主进程发消息的事件以及主进程监听的事件都写在这里，但是这里也只是规定了都有什么，并没有具体实现
 * 具体实现在 src/main/services/ipc-main-custom-handle.ts
 */
export class IpcChannelMainCustomClass {
  GetLoginState: IpcMainEventListener<void, boolean>;
  OpenDevTools: IpcMainEventListener;
  LoginSuccess: IpcMainEventListener<{
    userData: any;
    token?: string;
    refreshToken?: string;
  }>;
  Test: IpcMainEventListener;
  Logout: IpcMainEventListener;
  GetLoginUserInfo: IpcMainEventListener<void, UserData>;
  GetAuthInfo: IpcMainEventListener<void, Auth>;
}

/**
 * 主进程的IPC通道事件
 * 给主进程发消息的事件以及主进程监听的事件都写在这里，但是这里也只是规定了都有什么，并没有具体实现
 * 具体实现在 src/main/services/ipc-main-handle.ts
 */
export class IpcChannelMainClass extends IpcChannelMainCustomClass {
  IsUseSysTitle!: IpcMainEventListener<void, boolean>;
  /**
   * 退出应用
   */
  AppClose!: IpcMainEventListener;
  CheckUpdate!: IpcMainEventListener;
  ConfirmUpdate!: IpcMainEventListener;
  OpenMessageBox!: IpcMainEventListener<
    Electron.MessageBoxOptions,
    Electron.MessageBoxReturnValue
  >
  StartDownload!: IpcMainEventListener<string>
  OpenErrorbox!: IpcMainEventListener<{ title: string; message: string }>
  HotUpdate!: IpcMainEventListener

  /**
   * 重新加载主窗口
   */
  ReloadWin!: IpcMainEventListener
  /**
   *
   * 打开窗口
   */
  OpenWin!: IpcMainEventListener<{
    /**
     * 新的窗口地址
     *
     * @type {string}
     */
    url: string;

    /**
     * 是否是支付页
     *
     * @type {boolean}
     */
    IsPay?: boolean;

    /**
     * 支付参数
     *
     * @type {string}
     */
    PayUrl?: string;

    /**
     * 发送的新页面数据
     *
     * @type {unknown}
     */
    sendData?: unknown;
  }>
  CloseWin!: IpcMainEventListener
  GetAppVersion!: IpcMainEventListener<void, string>
}

/**
 * 渲染进程的IPC通道事件
 * 给渲染进程发消息的事件以及渲染进程监听的时间都写在这里，但是这里也只是规定了都有什么，并没有具体实现
 * 具体实现在 src/main/services/web-content-send.ts，但是是虚拟化的，可以就把这个当个interface来看
 * 主进程给渲染进程发消息的话，直接就 webContentSend.事件名 就行了
 * 如 webContentSend.SendDataTest(childWin.webContents, arg.sendData);
 */
export class IpcChannelRendererClass {
  // ipcRenderer
  DownloadProgress!: IpcRendererEventListener<number>
  DownloadError!: IpcRendererEventListener<Boolean>
  DownloadPaused!: IpcRendererEventListener<Boolean>
  DownloadDone!: IpcRendererEventListener<{
    /**
     * 下载的文件路径
     *
     * @type {string}
     */
    filePath: string;
  }>
  UpdateMsg!: IpcRendererEventListener<{
    state: number;
    msg: string | ProgressInfo;
  }>
  UpdateProcessStatus!: IpcRendererEventListener<{
    status:
      | "init"
      | "downloading"
      | "moving"
      | "finished"
      | "failed"
      | "download";
    message: string;
  }>;

  SendDataTest!: IpcRendererEventListener<unknown>;
  BrowserViewTabDataUpdate!: IpcRendererEventListener<{
    bvWebContentsId: number;
    title: string;
    url: string;
    status: 1 | -1; // 1 添加/更新 -1 删除
  }>;
  BrowserViewTabPositionXUpdate!: IpcRendererEventListener<{
    dragTabOffsetX: number;
    positionX: number;
    bvWebContentsId: number;
  }>;
  BrowserTabMouseup!: IpcRendererEventListener;
  HotUpdateStatus!: IpcRendererEventListener<{
    status: string;
    message: string;
  }>;
}

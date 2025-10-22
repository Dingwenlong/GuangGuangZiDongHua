// todo 是否将ipc-main.ts文件中的代码拆分到多个文件中？通过abstract继承？或者注册回调函数？
import { ipcMain, type IpcMainInvokeEvent } from 'electron';

type IpcHandler = {
  channel: string;
  handler: (...args: any[]) => any;
};

export function registerIpcHandlers(handlers: IpcHandler[] | IpcHandler) {
  if (Array.isArray(handlers)) {
    handlers.forEach(registerIpcHandlers);
    return;
  }
  // 包装原始处理程序，添加日志功能
  const wrappedHandler = async (...args: any[]) => {
    console.log(`[IPC] Handling channel: ${handlers.channel}`);
    try {
      return await handlers.handler(...args);
    } catch (error) {
      console.error(`[IPC] Error in channel ${handlers.channel}:`, error);
      throw error; // 重新抛出错误以保持原有行为
    }
  };

  ipcMain.handle(handlers.channel, wrappedHandler);
  // console.log(`Registered IPC handler for channel: ${handlers.channel}`)
}

export function unregisterIpcHandlers(handlers: IpcHandler[] | IpcHandler) {
  if (Array.isArray(handlers)) {
    handlers.forEach(unregisterIpcHandlers);
    return;
  }

  try {
    // 移除指定通道的处理程序
    ipcMain.removeHandler(handlers.channel);
    // console.log(`Unregistered IPC handler for channel: ${handlers.channel}`)
  } catch (error) {
    console.warn(
      `Failed to unregister IPC handler for channel: ${handlers.channel}. Error: ${error}`
    );
  }
}

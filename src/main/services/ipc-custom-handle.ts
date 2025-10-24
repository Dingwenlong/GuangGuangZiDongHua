import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import config from '@config/index';
import type MainInit from './window-manager';
import authManager from './auth-manager';
import WorkbenchManager, {
  type OrderedVideosChunk,
  type WorkbenchStoreSchema,
} from './workbench-manager';
import { webContentSend } from './web-content-send';
import DirectoryMonitor from './directory-monitor';
import VideoProcessor from './video-processor';
import AudioProcessor from './audio-processing';
import PlaywrightScript from './playwright';
import { formatArrayDiff } from '@main/utils/array';
import VideoSceneSplitter from './video-scene-splitter';

/**
 * 自定义全局
 * @param mainInit
 */
export const ipcCustomGlobalHandlers = (mainInit: MainInit): IpcHandler[] => {
  return [
    {
      channel: 'GetLoginState',
      handler: async () =>
        config.IgnoreLogin || (await authManager.isLoggedIn()),
    },
    {
      channel: 'OpenDevTools',
      handler: async event => {
        event.sender?.openDevTools({
          mode: 'undocked',
          activate: true,
        });
      },
    },
  ];
};

/**
 * 自定义登录
 * @param mainInit
 * @returns
 */
export const ipcCustomLoginHandlers = (mainInit: MainInit): IpcHandler[] => {
  return [
    {
      channel: 'LoginSuccess',
      handler: async (
        _,
        arg: { userData: any; token: any; refreshToken: any }
      ) => {
        const { userData, token, refreshToken } = arg;
        await authManager.setLoginState(userData, token, refreshToken);

        BrowserWindow.getAllWindows().forEach(win => {
          win.close();
        });
        await mainInit.createMainWindow();
      },
    },
  ];
};

/**
 * 自定义主窗口
 * @param mainInit
 * @returns
 */
export const ipcCustomMainHandlers = (mainInit: MainInit): IpcHandler[] => {
  const mainWindow = mainInit.mainWindow!;
  const playwrightScript = new PlaywrightScript();
  const workbenchManager = new WorkbenchManager();
  const audioProcessor = new AudioProcessor();
  const videoSceneSplitter = new VideoSceneSplitter();
  const videoProcessor = new VideoProcessor('');
  const dirMonitors: DirectoryMonitor[] = [];
  const isTest = true;
  let isWatermarkRemovalRunning = false;

  // 初始化事件
  // s1动态执行
  workbenchManager.watch('s1', (newValue: WorkbenchStoreSchema['s1']) => {
    if (!newValue.taskDirectory || !newValue.monitoringRunning) {
      videoProcessor?.stop();
      return;
    }
    if (videoProcessor) videoProcessor.stop();
    if (videoProcessor.monitorDirectory !== newValue.taskDirectory)
      videoProcessor.monitorDirectory = newValue.taskDirectory;
    if (newValue.monitoringRunning) videoProcessor.start();
  });
  // s2队列监视
  workbenchManager.watchArray('s2TasksQueue', (diff, newValue, oldValue) => {
    const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `任务队列发生变化: ${diffMessage}`,
      type: 'info',
    });
    if (diff.added.length > 0) {
      console.log('新增任务:', diff.added);
    }
    if (diff.removed.length > 0) {
      console.log('删除任务:', diff.removed);
    }
  });
  // ----------------------执行完每一步之后的回调处理---------------------
  // 第一步完成之后
  videoProcessor.on(
    's1OkCallback',
    async (videoPath: string, videosChunk: OrderedVideosChunk) => {
      const targetPath = videoPath.replace('S1---', 'S2---');
      // 保存到工作区队列
      workbenchManager.pushTask('s2TasksQueue', videoPath);
      // 保存视频链路用于后续拆解
      await workbenchManager.pushTask('s3TasksQueue', targetPath, videosChunk);

      if (isTest) {
        // 测试过程直接重命名文件为S2
        fs.renameSync(videoPath, targetPath);
        await playwrightScript.okCallback(targetPath);
      } else {
        if (isWatermarkRemovalRunning) {
          webContentSend.LogUpdate(mainWindow.webContents, {
            message: '有视频去水印任务正在运行，当前任务将等待后续处理',
            type: 'info',
          });
          return;
        }
        isWatermarkRemovalRunning = true;
        await playwrightScript.runWatermarkRemoval(
          videoPath,
          path.dirname(videoPath)
        );
        isWatermarkRemovalRunning = false;
      }
    }
  );
  // 第二步完成之后
  playwrightScript.on('s2OkCallback', videoPath => {
    workbenchManager.removeTask('s2TasksQueue', videoPath);
    videoProcessor.splitVideo(videoPath);
  });
  // 第三步完成之后
  videoProcessor.on('s3OkCallback', () => {});
  // 第四步完成之后
  videoSceneSplitter.on('s4OkCallback', () => {});
  // ----------------------其他的---------------------
  audioProcessor.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message,
      type,
    });
  });
  playwrightScript.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message,
      type,
    });
  });
  videoProcessor.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message,
      type,
    });
  });
  videoProcessor.on('status', data => {
    webContentSend.MonitoringVideoStatusUpdate(mainWindow.webContents, data);
  });

  return [
    {
      channel: 'Test',
      handler: async () => {},
    },
    {
      channel: 'RunWatermarkRemoval',
      handler: async (_, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        return await playwrightScript.runWatermarkRemoval(filePath, targetDir);
      },
    },
    {
      channel: 'CheckKaipaiLoginStatus',
      handler: async () => {
        return await playwrightScript.CheckKaipaiLoginStatus();
      },
    },
    //--------------------------工作台--------------------------
    {
      channel: 'GetWorkbenchData',
      handler: async (_, stepNo: any) => {
        return await workbenchManager.getByKey(stepNo);
      },
    },
    {
      channel: 'UpdateWorkbenchData',
      handler: async (_, args: { stepNo: any; sData: any }) => {
        await workbenchManager.updateStep(args.stepNo, args.sData);
      },
    },
    //--------------------------文件夹监听（工作目录、发布目录）--------------------------
    {
      channel: 'StartMonitoringDirectory',
      handler: async (_, directory: string) => {
        // 当前文件夹已被监听
        if (
          dirMonitors.findIndex(
            monitor => monitor.monitorDirectory === directory
          ) > -1
        ) {
          return;
        }

        const dirMonitor = new DirectoryMonitor(directory, {
          maxDepth: 3, // 监控深度
          updateInterval: 30000, // 30秒更新一次
          debounceDelay: 500, // 500ms防抖延迟
        });
        dirMonitors.push(dirMonitor);

        dirMonitor.on('directoryStructure', ({ root, structure }) => {
          webContentSend.MonitoringDirectoryCallback(mainWindow.webContents, {
            root,
            structure,
          });
        });
        dirMonitor.on('log', ({ message, type }) => {
          webContentSend.LogUpdate(mainWindow.webContents, {
            message,
            type,
          });
        });

        dirMonitor.start();
      },
    },
    {
      channel: 'StopMonitoringDirectory',
      handler: async (_, directory: string) => {
        const dirMonitor = dirMonitors.find(
          monitor => monitor.monitorDirectory === directory
        );
        if (dirMonitor) dirMonitor.stop();
      },
    },
    //--------------------------登录--------------------------
    {
      channel: 'Logout',
      handler: async () => {
        await authManager.clearLoginState();
        BrowserWindow.getAllWindows().forEach(win => {
          win.close();
        });
        await mainInit.createLoginWindow();
      },
    },
    {
      channel: 'GetLoginUserInfo',
      handler: async () => {
        return await authManager.getUserInfo();
      },
    },
    {
      channel: 'GetAuthInfo',
      handler: async () => {
        return await authManager.getAuthInfo();
      },
    },
    {
      channel: 'RunVideoQualityFix',
      handler: async (event, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        return await playwrightScript.RunVideoQualityFix(filePath, targetDir);
      },
    },
    {
      channel: 'ProcessAudio',
      handler: async (event, arg: { audioPath: string }) => {
        const { audioPath } = arg;
        return await audioProcessor.processAudio(audioPath);
      },
    },
    {
      channel: 'GetAudioProcessingStats',
      handler: async () => {
        return audioProcessor.getProcessingStats();
      },
    },
  ];
};

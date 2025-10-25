import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import config from '@config/index';
import type MainInit from './window-manager';
import authManager from './auth-manager';
import WorkbenchManager, {
  type OrderedFolderItem,
  type OrderedVideosChunk,
  type WorkbenchStoreSchema,
} from './workbench-manager';
import { webContentSend } from './web-content-send';
import DirectoryMonitor from './directory-monitor';
import VideoProcessor from './video-processor';
import AudioProcessor from './audio-processing';
import PlaywrightScript from './playwright';
import { formatArrayDiff } from '@main/utils/array';
import VideoSceneSplitter, { type SplitResult } from './video-scene-splitter';
import TaskScheduler from '../lib/task-scheduler'; // 创建任务调度器
import { insertDirectoryBeforeLast } from '@main/utils/file';

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
  const videoProcessor = new VideoProcessor('');
  const videoSceneSplitter = new VideoSceneSplitter({
    reencode: true, // 重新编码确保时长准确
  });
  const dirMonitors: DirectoryMonitor[] = [];
  const scheduler = new TaskScheduler();
  const isTest = true;

  // ----------------------执行每一步---------------------
  // s1
  workbenchManager.watch('s1', async (newValue: WorkbenchStoreSchema['s1']) => {
    const status = videoProcessor.getStatus();
    if (!newValue.taskDirectory || !newValue.running) {
      if (status.monitoring) videoProcessor.stop();
      return;
    }
    const normalizedNewValue = path.normalize(newValue.taskDirectory);
    const normalizedMonitorDir = path.normalize(
      videoProcessor.monitorDirectory
    );
    if (normalizedNewValue !== normalizedMonitorDir)
      await videoProcessor.updateWatchedDirectory(newValue.taskDirectory);

    if (!status.monitoring) {
      videoProcessor.start();
      console.log('执行任务s1');
    }
  });
  // s2
  // 每5秒执行一次，并发数为1
  scheduler.addTask(
    {
      name: 's2Task',
      interval: 5000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      const task = await workbenchManager.dequeueTask('s2TasksQueue');
      if (!task) return;
      console.log('执行任务s2');

      const videoFilePath = task as string;
      if (isTest) {
        // 测试过程直接重命名文件为S2
        const targetPath = videoFilePath.replace('S1---', 'S2---');
        fs.renameSync(videoFilePath, targetPath);
        await playwrightScript.okCallback(targetPath);
      } else {
        await playwrightScript.runWatermarkRemoval(
          videoFilePath,
          path.dirname(videoFilePath)
        );
      }
    }
  );
  workbenchManager.watch('s2', (newValue: WorkbenchStoreSchema['s2']) => {
    if (!newValue.running) scheduler.disableTask('s2Task');
    else scheduler.enableTask('s2Task');
  });
  // s3
  // 每5秒执行一次，并发数为1
  scheduler.addTask(
    {
      name: 's3Task',
      interval: 5000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      const task = await workbenchManager.dequeueTask('s3TasksQueue');
      if (!task) return;
      console.log('执行任务s3');

      videoProcessor.splitVideo(task as OrderedVideosChunk);
    }
  );
  workbenchManager.watch('s3s4', (newValue: WorkbenchStoreSchema['s3s4']) => {
    if (!newValue.running) scheduler.disableTask('s3Task');
    else scheduler.enableTask('s3Task');
  });
  // s4
  // 每5秒执行一次，并发数为1
  scheduler.addTask(
    {
      name: 's4Task',
      interval: 5000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      const task = await workbenchManager.dequeueTask('s4TasksQueue');
      if (!task) return;
      console.log('执行任务s4');

      const s3s4 = await workbenchManager.getByKey('s3s4');
      const folderItem = task as OrderedFolderItem;

      // ！------------记录一下视频切片路径，执行下一步混剪逻辑---------
      for (const video of folderItem.videos) {
        const videoPath = folderItem.folderName + video.fileName;
        const outputDir =
          insertDirectoryBeforeLast(folderItem.folderName, '视频分镜') +
          '---' +
          video.fileName.split('---').pop()?.split('.')[0];
        await videoSceneSplitter.split(videoPath, outputDir, {
          initialLength: s3s4.storyboardDuration1, // 初始
          extendedLength: s3s4.storyboardDuration2, // 延长
          lookahead: 2, // 检查2秒
          maxSegments: s3s4.productMaterialNum, // 最多4个片段
          sceneThreshold: s3s4.storyboardSceneThreshold, // 场景变化阈值
        });
      }
    }
  );
  workbenchManager.watch('s3s4', (newValue: WorkbenchStoreSchema['s3s4']) => {
    if (!newValue.running) scheduler.disableTask('s3Task');
    else scheduler.enableTask('s3Task');
  });
  // 启动所有任务
  scheduler.startAllTasks();
  //scheduler.stopTask('s4Task');
  // ----------------------执行完每一步之后的回调处理---------------------
  // 第一步完成之后
  videoProcessor.on('s1OkCallback', async (videosChunk: OrderedVideosChunk) => {
    // 增加第二步队列
    await workbenchManager.enqueueTask(
      's2TasksQueue',
      videosChunk.videoFilePath
    );
    // 增加第三步队列 videosChunk 内部有参数控制不会直接执行
    videosChunk.videoFilePath = videosChunk.videoFilePath.replace(
      'S1---',
      'S2---'
    );
    await workbenchManager.enqueueTask('s3TasksQueue', videosChunk);
  });
  // 第二步完成之后
  playwrightScript.on('s2OkCallback', videoPath => {
    // 通知 workbenchManager 去字幕任务完成
    workbenchManager.updateSubtitleRemoveOver(videoPath, true);
  });
  // 第三步完成之后
  videoProcessor.on(
    's3OkCallback',
    async (newPathOfChains: OrderedFolderItem[]) => {
      // 增加第四步队列
      newPathOfChains.forEach(async pathOfChain => {
        await workbenchManager.enqueueTask('s4TasksQueue', pathOfChain);
      });
    }
  );
  // 第四步之一完成之后
  videoSceneSplitter.on('s4-1OkCallback', (splitResult: SplitResult) => {});
  // 第四步之二完成之后
  videoSceneSplitter.on('s4-2OkCallback', (splitResult: SplitResult) => {});
  // ----------------------其他的---------------------
  // 输出日志
  // s2队列监视
  workbenchManager.watchArray('s2TasksQueue', (diff, newValue, oldValue) => {
    const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S2去字幕任务队列发生变化: ${diffMessage}`,
      type: 'info',
    });
    if (diff.added.length > 0) {
      console.log('新增s2任务:', diff.added);
    }
    if (diff.removed.length > 0) {
      console.log('删除s2任务:', diff.removed);
    }
  });
  // s3队列监视
  workbenchManager.watchArray('s3TasksQueue', (diff, newValue, oldValue) => {
    const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S3视频拆分任务队列发生变化: ${diffMessage}`,
      type: 'info',
    });
    if (diff.added.length > 0) {
      console.log('新增s3任务:', diff.added);
    }
    if (diff.removed.length > 0) {
      console.log('删除s3任务:', diff.removed);
    }
  });
  // s4队列监视
  workbenchManager.watchArray('s4TasksQueue', (diff, newValue, oldValue) => {
    const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S4视频切割分镜任务队列发生变化: ${diffMessage}`,
      type: 'info',
    });
    if (diff.added.length > 0) {
      console.log('新增s4任务:', diff.added);
    }
    if (diff.removed.length > 0) {
      console.log('删除s4任务:', diff.removed);
    }
  });
  videoProcessor.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message,
      type,
    });
  });
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

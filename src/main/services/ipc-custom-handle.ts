import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import config from '@config/index';
import type MainInit from './window-manager';
import authManager from './auth-manager';
import WorkbenchManager, {
  type FolderItem,
  type S3VideosChunk,
  type S4VideosChunk,
  type WorkbenchStoreSchema,
} from './workbench-manager';
import { webContentSend } from './web-content-send';
import DirectoryMonitor from './directory-monitor';
import VideoProcessor from './video-processor';
import AudioExtractor from './audio-extractor';
import AudioProcessor from './audio-processing';
import PlaywrightScript from './playwright';
import { formatArrayDiff } from '@main/utils/array';
import VideoSceneSplitter from './video-scene-splitter';
import TaskScheduler from '../lib/task-scheduler'; // 创建任务调度器

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
  const audioExtractor = new AudioExtractor();
  const audioProcessor = new AudioProcessor();
  const videoProcessor = new VideoProcessor('');
  const videoSceneSplitter = new VideoSceneSplitter();
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

      videoProcessor.splitVideo(task as S3VideosChunk);
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

      const s4VideosChunk = task as S4VideosChunk;
      const s3s4 = await workbenchManager.getByKey('s3s4');
      const options = {
        initialLength: s3s4.storyboardDuration1, // 初始
        extendedLength: s3s4.storyboardDuration2, // 延长
        lookahead: 2, // 检查2秒
        maxSegments: s3s4.productMaterialNum, // 最多4个片段
        sceneThreshold: s3s4.storyboardSceneThreshold, // 场景变化阈值
      };
      await videoSceneSplitter.workflow(s4VideosChunk, options);
    }
  );
  workbenchManager.watch('s3s4', (newValue: WorkbenchStoreSchema['s3s4']) => {
    if (!newValue.running) scheduler.disableTask('s3Task');
    else scheduler.enableTask('s3Task');
  });
  // s5
  // 每5秒执行一次，并发数为1
  // 添加音频处理计数器
  let audioProcessCount = 0;
  const latencyTime = 3 * 60 * 1000; // 3分钟等待时间
  let isRebooting = false; // 重启标志

  scheduler.addTask(
    {
      name: 's5Task',
      interval: 5000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      // 如果正在重启，跳过当前任务
      if (isRebooting) {
        console.log('服务正在重启中，等待3分钟后再继续处理任务');
        return;
      }

      const task = await workbenchManager.dequeueTask('s5TasksQueue');
      if (!task) return;
      console.log('执行任务s5');

      try {
        // 处理音频提取任务
        const videoPath = task as string;
        // 提取音频
        const extractResult = await audioExtractor.extractAudio(videoPath);
        console.log('音频提取完成:', extractResult);

        // 检查是否需要重启服务
        if (audioProcessCount >= 5) {
          console.log(`已处理${audioProcessCount}个音频文件，准备重启服务`);

          // 设置重启标志
          isRebooting = true;

          try {
            // 调用重启服务方法，不需要等待返回
            void audioProcessor.rebootService();
            console.log('已发送重启服务请求');
          } catch (rebootError) {
            console.error('重启服务失败，但继续执行:', rebootError);
          }

          // 重置计数器
          audioProcessCount = 0;

          // 等待3分钟
          console.log('等待3分钟后继续处理...');
          await new Promise(resolve => setTimeout(resolve, latencyTime));
          console.log('等待时间结束，继续处理任务');

          // 重置重启标志
          isRebooting = false;
        }

        // 处理音频
        const processResult = await audioProcessor.processAudio(
          extractResult.outputPath
        );
        console.log('音频处理完成:', processResult);

        // 增加处理计数
        audioProcessCount++;

        // 加入S6队列
        // await workbenchManager.enqueueTask('s6TasksQueue', videoPath);
      } catch (error) {
        console.error('S5任务执行失败:', error);
      }
    }
  );
  workbenchManager.watch('s5', (newValue: WorkbenchStoreSchema['s5']) => {
    if (!newValue.running) scheduler.disableTask('s5Task');
    else scheduler.enableTask('s5Task');
  });

  // s6
  // 每5秒执行一次，并发数为1
  scheduler.addTask(
    {
      name: 's6Task',
      interval: 5000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      const task = await workbenchManager.dequeueTask('s6TasksQueue');
      if (!task) return;
      console.log('执行任务s6');

      const videoFilePath = task as string;
      if (isTest) {
        // 测试过程直接重命名文件为S6
        const targetPath = videoFilePath.replace('S6---', 'S7---');
        fs.renameSync(videoFilePath, targetPath);
        await playwrightScript.okCallback(targetPath);
      } else {
        await playwrightScript.RunVideoQualityFix(
          videoFilePath,
          path.dirname(videoFilePath)
        );
      }
    }
  );
  workbenchManager.watch('s6', (newValue: WorkbenchStoreSchema['s6']) => {
    if (!newValue.running) scheduler.disableTask('s6Task');
    else scheduler.enableTask('s6Task');
  });
  // 启动所有任务
  scheduler.startAllTasks();
  scheduler.stopTask('s2Task');
  scheduler.stopTask('s3Task');
  // ----------------------执行完每一步之后的回调处理---------------------
  // 第一步完成之后
  videoProcessor.on('s1OkCallback', async (videosChunk: S3VideosChunk) => {
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
  playwrightScript.on('s2OkCallback', async videoPath => {
    // 通知 workbenchManager 去字幕任务完成
    await workbenchManager.updateSubtitleRemoveOver(videoPath, true);
  });
  // 第三步完成之后
  videoProcessor.on('s3OkCallback', async (newPathOfChains: FolderItem[]) => {
    // 增加第四步队列
    newPathOfChains.forEach(async pathOfChain => {
      await workbenchManager.enqueueTask(
        's4TasksQueue',
        pathOfChain as S4VideosChunk
      );
    });
  });

  // 第四步完成之后
  videoSceneSplitter.on('s4OkCallback', async (videos: string[]) => {
    for (const video of videos) {
      await workbenchManager.enqueueTask('s4TasksQueue', video);
    }
  });

  // 第五步完成之后
  audioExtractor.on('s5OkCallback', result => {
    // 增加第六步队列
    workbenchManager.enqueueTask('s6TasksQueue', result.inputPath);
  });
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

  // s5队列监视
  workbenchManager.watchArray('s5TasksQueue', (diff, newValue, oldValue) => {
    const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S5任务队列发生变化: ${diffMessage}`,
      type: 'info',
    });
    if (diff.added.length > 0) {
      console.log('新增任务:', diff.added);
    }
    if (diff.removed.length > 0) {
      console.log('删除任务:', diff.removed);
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

  // 音频提取器日志监听
  audioExtractor.on('log', ({ message, type }) => {
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
      channel: 'ProcessAudio',
      handler: async (event, arg: { audioPath: string }) => {
        const { audioPath } = arg;
        return await audioProcessor.processAudio(audioPath);
      },
    },
    {
      channel: 'ProcessAudioExtract',
      handler: async (event, arg: { videoPath: string }) => {
        const { videoPath } = arg;
        return await audioExtractor.extractAudio(videoPath);
      },
    },
  ];
};

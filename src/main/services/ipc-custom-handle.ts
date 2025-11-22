import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import config from '@config/index';
import type MainInit from './window-manager';
import authManager from './auth-manager';
import workbenchManager, {
  WorkbenchTaskStatus,
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
import GuangheTaobao from './guanghe-taobao';
// import GuangheCes from './guanghe-ces';
import VideoSceneSplitter from './video-scene-splitter';
import TaskScheduler from '../lib/task-scheduler'; // 创建任务调度器
import S5TaskProcessor from './s5-task-processor';
import { GuangProcessor } from './guang-processor';

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
        try {
          const { userData, token, refreshToken } = arg;

          // 保存登录状态，添加超时保护
          await Promise.race([
            authManager.setLoginState(userData, token, refreshToken),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('保存登录状态超时')), 5000);
            }),
          ]);

          // 获取所有窗口并关闭，但要确保主窗口创建成功后再关闭
          const allWindows = BrowserWindow.getAllWindows();
          console.log(`准备关闭 ${allWindows.length} 个窗口`);

          // 创建主窗口，添加超时保护
          await Promise.race([
            mainInit.createMainWindow(),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('创建主窗口超时')), 10000);
            }),
          ]);

          // 确保主窗口创建成功后再关闭其他窗口
          allWindows.forEach(win => {
            if (win && !win.isDestroyed()) {
              win.close();
            }
          });

          console.log('登录成功，主窗口创建完成');
        } catch (error) {
          console.error('登录成功处理失败:', error);
          // 尝试重新创建登录窗口作为回退方案
          mainInit.createLoginWindow();
        }
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
  const guangheTaobao = new GuangheTaobao();
  // const guangheces = new GuangheCes();
  const audioExtractor = new AudioExtractor();
  const audioProcessor = new AudioProcessor();
  const videoProcessor = new VideoProcessor('');
  const videoSceneSplitter = new VideoSceneSplitter();
  const scheduler = new TaskScheduler();
  const s5TaskProcessor = new S5TaskProcessor(audioExtractor, audioProcessor);
  const guangProcessor = new GuangProcessor();
  const dirMonitors: DirectoryMonitor[] = [];
  const isTest = false;

  // ----------------------执行每一步---------------------
  // s1
  workbenchManager.watch('s1', async (newValue: WorkbenchStoreSchema['s1']) => {
    const status = videoProcessor.getStatus();
    if (!newValue.taskDirectory || !newValue.running) {
      if (status.monitoring) await videoProcessor.stop();
      return;
    }

    if (videoProcessor.monitorDirectory !== newValue.taskDirectory)
      videoProcessor.updateWatchedDirectory(newValue.taskDirectory);

    if (!status.monitoring) videoProcessor.start();
  });
  // s2
  // 每5秒执行一次，并发数为2
  scheduler.addTask(
    {
      name: 's2Task',
      interval: 5000,
      concurrency: 2,
      enabled: true,
    },
    async () => {
      const task = await workbenchManager.dequeueTask('s2TasksQueue');
      if (!task) return;

      const [videoFilePath, id] = task as [string, number];
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
      // 通知任务完成
      await workbenchManager.updateTaskStatus(
        's2TasksQueue',
        id,
        WorkbenchTaskStatus.COMPLETED
      );
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

      const [s3VideosChunk, id] = task as [S3VideosChunk, number];
      await videoProcessor.splitVideo(s3VideosChunk);
      // 通知任务完成
      await workbenchManager.updateTaskStatus(
        's3TasksQueue',
        id,
        WorkbenchTaskStatus.COMPLETED
      );
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

      const s3s4 = await workbenchManager.getByKey('s3s4');
      const [s4VideosChunk, id] = task as [S4VideosChunk, number];
      await videoSceneSplitter.workflow(s4VideosChunk, {
        initialLength: 4, // 初始
        extendedLength: 5, // 延长
        lookahead: 2, // 检查2秒
        maxSegments: 4, // 最多4个片段
        sceneThreshold: s3s4.storyboardSceneThreshold, // 场景变化阈值
      });
      // 通知任务完成
      await workbenchManager.updateTaskStatus(
        's4TasksQueue',
        id,
        WorkbenchTaskStatus.COMPLETED
      );
    }
  );
  workbenchManager.watch('s3s4', (newValue: WorkbenchStoreSchema['s3s4']) => {
    if (!newValue.running) scheduler.disableTask('s4Task');
    else scheduler.enableTask('s4Task');
  });
  // s5
  // 每5秒执行一次，并发数为1
  scheduler.addTask(
    {
      name: 's5Task',
      interval: 5000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      await s5TaskProcessor.execute();
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

      const [videoFilePath, id] = task as [string, number];
      try {
        // 处理任务
        await playwrightScript.RunVideoQualityFix(
          videoFilePath,
          path.dirname(videoFilePath)
        );
      } catch (error) {
        console.error('处理S6任务出错，ID:', id, '错误:', error);
        // 任务失败，更新状态为FAILED
        await workbenchManager.updateTaskStatus(
          's6TasksQueue',
          id,
          WorkbenchTaskStatus.FAILED
        );
      }
    }
  );
  workbenchManager.watch('s6', (newValue: WorkbenchStoreSchema['s6']) => {
    if (!newValue.running) scheduler.disableTask('s6Task');
    else scheduler.enableTask('s6Task');
  });
  // s7
  workbenchManager.watch(
    's7',
    async (
      newValue: WorkbenchStoreSchema['s7'],
      oldValue: WorkbenchStoreSchema['s7']
    ) => {
      if (!newValue.running || oldValue.taskDirectory != newValue.taskDirectory)
        await guangProcessor.stopMonitor();
      if (newValue.running && newValue.taskDirectory)
        await guangProcessor.startMonitor(newValue.taskDirectory);
    }
  );
  // s8
  // 每5秒执行一次，并发数为1
  scheduler.addTask(
    {
      name: 's8Task',
      interval: 10 * 1000,
      concurrency: 1,
      enabled: true,
    },
    async () => {
      const s8 = await workbenchManager.getByKey('s8');
      if (s8.running) await guangheTaobao.checkAndUpdateDirectories();
    }
  );
  workbenchManager.getByKey('s8').then(newValue => {
    if (newValue.taskDirectory)
      guangProcessor.setAccountDirectory(newValue.taskDirectory);
  });
  workbenchManager.watch('s8', async (newValue: WorkbenchStoreSchema['s8']) => {
    if (newValue.running)
      guangProcessor.setAccountDirectory(newValue.taskDirectory);
  });
  // 启动所有任务
  scheduler.startAllTasks();
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
  videoProcessor.on(
    's3OkCallback',
    async (newPathOfChains: S4VideosChunk[]) => {
      for (const newPathOfChain of newPathOfChains) {
        await workbenchManager.enqueueTask('s4TasksQueue', newPathOfChain);
      }
    }
  );
  // 第四步完成之后
  videoSceneSplitter.on('s4OkCallback', async (videos: string[]) => {
    await workbenchManager.enqueueTask('s5TasksQueue', videos);
  });
  // 第五步完成之后（从audioProcessor监听事件）
  audioProcessor.on('s5OkCallback', async (savePath: string[]) => {
    // 增加第六步队列
    for (const path of savePath) {
      await workbenchManager.enqueueTask('s6TasksQueue', path);
    }
    // console.log('新增s6任务:', savePath);
  });
  // ----------------------其他的---------------------
  // 输出日志
  // s2队列监视
  workbenchManager.watchArray('s2TasksQueue', (diff, newValue, oldValue) => {
    // const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S2去字幕任务队列发生变化`,
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
    // const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S3视频拆分任务队列发生变化`,
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
    // const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S4视频切割分镜任务队列发生变化`,
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
    // const diffMessage = formatArrayDiff(diff);
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: `S5任务队列发生变化`,
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
      message: '[videoProcessor]' + message,
      type,
    });
  });
  audioProcessor.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: '[audioProcessor]' + message,
      type,
    });
  });
  playwrightScript.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: '[playwrightScript]' + message,
      type,
    });
  });
  guangheTaobao.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: '[guangheTaobao]' + message,
      type,
    });
  });

  // 音频提取器日志监听
  audioExtractor.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: '[audioExtractor]' + message,
      type,
    });
  });

  // 淘宝光合日志监听
  guangProcessor.on('log', ({ message, type }) => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message: '[guangheProcessor]' + message,
      type,
    });
  });

  return [
    {
      channel: 'RunWatermarkRemoval',
      handler: async (_, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        return await playwrightScript.runWatermarkRemoval(filePath, targetDir);
      },
    },
    {
      channel: 'RunVideoQualityFix',
      handler: async (_, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        return await playwrightScript.RunVideoQualityFix(filePath, targetDir);
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
          maxDepth: 2, // 监控深度
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
    {
      channel: 'guangheCes',
      handler: async (event, arg: { videoPath: string }) => {
        // return await guangheces.GuangheTaobaoIssue();
      },
    },
  ];
};

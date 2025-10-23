import type MainInit from './window-manager';
import authManager from './auth-manager';
import workbenchManager from './workbench-manager';
// import { runWatermarkRemoval, checkLoginStatus } from "./playwright";
import config from '@config/index';
import { BrowserWindow } from 'electron';
import * as path from 'path';
import VideoProcessor from './video-processor';
import AudioProcessor from './audio-processing';
import PlaywrightScript from './playwright';
import DirectoryMonitor from './directory-monitor';
import { webContentSend } from './web-content-send';

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

let videoProcessor: VideoProcessor | null = null;
let audioProcessor: AudioProcessor | null = null;
let playwrightScript: PlaywrightScript | null = null;
let dirMonitor: DirectoryMonitor | null = null;
// 控制脚本串行执行的状态变量
let isWatermarkRemovalRunning = false;

/**
 * 自定义主窗口
 * @param mainInit
 * @returns
 */
export const ipcCustomMainHandlers = (mainInit: MainInit): IpcHandler[] => {
  return [
    {
      channel: 'Test',
      handler: () => {
        // authManager.clearLoginState();
      },
    },
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
      channel: 'RunWatermarkRemoval',
      handler: async (event, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        if (playwrightScript) {
          playwrightScript = null;
        }
        playwrightScript = new PlaywrightScript();
        playwrightScript.on('log', ({ message, type }) => {
          if (mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
              message,
              type,
            });
        });
        return await playwrightScript.runWatermarkRemoval(filePath, targetDir);
      },
    },
    {
      channel: 'RunVideoQualityFix',
      handler: async (event, arg: { filePath: string; targetDir: string }) => {
        const { filePath, targetDir } = arg;
        if (playwrightScript) {
          playwrightScript = null;
        }
        playwrightScript = new PlaywrightScript();
        playwrightScript.on('log', ({ message, type }) => {
          if (mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
              message,
              type,
            });
        });
        return await playwrightScript.RunVideoQualityFix(filePath, targetDir);
      },
    },
    {
      channel: 'CheckKaipaiLoginStatus',
      handler: async event => {
        if (playwrightScript) {
          playwrightScript = null;
        }
        playwrightScript = new PlaywrightScript();
        playwrightScript.on('log', ({ message, type }) => {
          if (mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
              message,
              type,
            });
        });
        return await playwrightScript.CheckKaipaiLoginStatus();
      },
    },
    {
      channel: 'UpdateWorkbenchData',
      handler: async (_, args: { stepNo: any; sData: any }) => {
        return await workbenchManager.updateData(args.stepNo, args.sData);
      },
    },
    {
      channel: 'GetWorkbenchData',
      handler: async (_, stepNo: any) => {
        return await workbenchManager.getInfo(stepNo);
      },
    },
    {
      channel: 'StartMonitoringDirectory',
      handler: async (_, directory: string) => {
        if (dirMonitor) {
          dirMonitor.stop();
        }

        dirMonitor = new DirectoryMonitor(directory, {
          maxDepth: 3, // 监控深度
          updateInterval: 30000, // 30秒更新一次
          debounceDelay: 500, // 500ms防抖延迟
        });
        dirMonitor.on('directoryStructure', ({ root, structure }) => {
          if (mainInit.mainWindow)
            webContentSend.MonitoringDirectoryCallback(
              mainInit.mainWindow.webContents,
              { root, structure }
            );
        });
        dirMonitor.on('log', ({ message, type }) => {
          if (mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
              message,
              type,
            });
        });

        dirMonitor.start();
        return { success: true };
      },
    },
    {
      channel: 'StopMonitoringDirectory',
      handler: async () => {
        if (dirMonitor) {
          dirMonitor.stop();
          return { success: true };
        }
        return { success: false };
      },
    },
    {
      channel: 'StartMonitoringVideo',
      handler: async (event, directory: string) => {
        if (videoProcessor) {
          videoProcessor.stop();
        }

        videoProcessor = new VideoProcessor(directory);
        videoProcessor.on('status', data => {
          if (mainInit.mainWindow)
            webContentSend.MonitoringVideoStatusUpdate(
              mainInit.mainWindow.webContents,
              data
            );
        });
        videoProcessor.on('log', ({ message, type }) => {
          if (mainInit.mainWindow)
            webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
              message,
              type,
            });
        });
        videoProcessor.on(
          'addToSubtitleRemoveQueue',
          async (
            videoPath: string,
            subtitleRemoveQueue: Array<string>,
            videosTable: string[][]
          ) => {
            // 检查是否已有任务在执行，如果有则不处理新任务
            if (isWatermarkRemovalRunning) {
              console.log('已有去水印任务在执行，跳过当前视频:', videoPath);

              if (mainInit.mainWindow)
                webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                  message: `已有去水印任务在执行，跳过当前视频: ${path.basename(
                    videoPath
                  )}`,
                  type: 'warning',
                });
              return;
            }

            // 保存视频链条用于第三步拆解
            let task: { [k: string]: any } = {};
            task[videoPath] = videosTable;
            workbenchManager.pushTask('subtitleRemoveRunningTasks', task);

            if (videoPath) {
              try {
                // 设置任务执行状态为正在运行
                isWatermarkRemovalRunning = true;

                // 初始化PlaywrightScript实例
                if (playwrightScript) {
                  playwrightScript = null;
                }
                playwrightScript = new PlaywrightScript();
                playwrightScript.on('log', ({ message, type }) => {
                  if (mainInit.mainWindow)
                    webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                      message,
                      type,
                    });
                });

                // 提取文件所在目录作为目标目录
                const targetDir = path.dirname(videoPath);

                // 调用runWatermarkRemoval处理视频
                const result = await playwrightScript.runWatermarkRemoval(
                  videoPath,
                  targetDir
                );

                // 处理完成后从队列中删除该元素
                if (result.success && videoProcessor) {
                  videoProcessor.removeToSubtitleRemoveQueue(videoPath);
                }
              } catch (error: any) {
                console.error('处理视频去水印失败:', error);
                if (mainInit.mainWindow)
                  webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                    message: `处理视频去水印失败: ${error.message}`,
                    type: 'error',
                  });
              } finally {
                // 无论成功失败，都设置任务执行状态为空闲
                isWatermarkRemovalRunning = false;
              }
            }
          }
        );

        videoProcessor.on(
          'audioExtractComplete',
          ({ outputPath }: { outputPath: string }) => {
            if (mainInit.mainWindow) {
              webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                message: `音频提取完成: ${path.basename(outputPath)}`,
                type: 'info',
              });

              // 触发ProcessAudio事件处理提取的音频，ProcessAudio会自动识别同文件夹下的同名视频文件
              if (audioProcessor) {
                audioProcessor.processAudio(outputPath).catch(error => {
                  console.error('处理音频失败:', error);
                  if (mainInit.mainWindow) {
                    webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                      message: `处理音频失败: ${error.message}`,
                      type: 'error',
                    });
                  }
                });
              } else {
                // 初始化audioProcessor并处理音频
                audioProcessor = new AudioProcessor();
                audioProcessor.on('log', ({ message, type }) => {
                  if (mainInit.mainWindow) {
                    webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                      message,
                      type,
                    });
                  }
                });
                audioProcessor.processAudio(outputPath).catch(error => {
                  console.error('处理音频失败:', error);
                  if (mainInit.mainWindow) {
                    webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                      message: `处理音频失败: ${error.message}`,
                      type: 'error',
                    });
                  }
                });
              }
            }
          }
        );

        videoProcessor.start();
        return { success: true };
      },
    },
    {
      channel: 'StopMonitoringVideo',
      handler: async () => {
        if (videoProcessor) {
          videoProcessor.stop();
          return { success: true };
        }
        return { success: false };
      },
    },

    {
      channel: 'ProcessAudio',
      handler: async (event, arg: { audioPath: string }) => {
        const { audioPath } = arg;
        if (!audioProcessor) {
          audioProcessor = new AudioProcessor();
          audioProcessor.on('log', ({ message, type }) => {
            if (mainInit.mainWindow) {
              webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                message,
                type,
              });
            }
          });
        }
        return await audioProcessor.processAudio(audioPath);
      },
    },
    {
      channel: 'GetAudioProcessingStats',
      handler: async () => {
        if (!audioProcessor) {
          audioProcessor = new AudioProcessor();
          audioProcessor.on('log', ({ message, type }) => {
            if (mainInit.mainWindow) {
              webContentSend.LogUpdate(mainInit.mainWindow.webContents, {
                message,
                type,
              });
            }
          });
        }
        return audioProcessor.getProcessingStats();
      },
    },
  ];
};

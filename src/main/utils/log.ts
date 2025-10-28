import type EventEmitter from 'events';
import log from 'electron-log/main';

log.transports.file.level = 'info';
log.transports.file.maxSize = 50 * 1024 * 1024;
log.initialize();

/*
  日志的存储目录:
  mac: ~/Library/Application Support
  windows: 搜索栏输入 %appdata%
*/
export default log;

export interface LogEvent {
  message: string;
  type: 'info' | 'error' | 'success' | 'warning' | 'debug';
}

export function writeLog(
  this: EventEmitter,
  message: string,
  type: LogEvent['type'] = 'info'
) {
  // 参数验证
  if (message === undefined || message === null || message === '') {
    console.error('writeLog called with invalid message:', message);
    return;
  }

  // 确保 type 是有效值
  const validTypes: LogEvent['type'][] = [
    'info',
    'error',
    'success',
    'warning',
    'debug',
  ];
  if (!validTypes.includes(type)) {
    console.warn(
      `writeLog called with invalid type: ${type}, defaulting to 'info'`
    );
    type = 'info';
  }

  // 记录日志
  try {
    switch (type) {
      case 'info':
        log.info(message);
        break;
      case 'error':
        log.error(message);
        break;
      case 'success':
        log.log(message);
        break;
      case 'warning':
        log.warn(message);
        break;
      case 'debug':
        log.debug(message);
        break;
    }

    this.emit('log', { message, type } as LogEvent);
  } catch (error) {
    console.error('Error in writeLog:', error);
  }
}

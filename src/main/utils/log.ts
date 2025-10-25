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
  type: LogEvent['type']
) {
  if (type === 'info') log.info(message);
  if (type === 'error') log.error(message);
  if (type === 'success') log.log(message);
  if (type === 'warning') log.warn(message);
  if (type === 'debug') log.debug(message);
  this.emit('log', {
    message,
    type,
  } as LogEvent);
}

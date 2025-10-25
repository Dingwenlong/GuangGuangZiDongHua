import path from 'path';

// 支持的视频格式
const videoExtensions = new Set<string>([
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.3gp',
  '.ogg',
]);

/**
 * 判断是否为视频文件
 * @param filePath 文件路径
 * @returns 是否为视频文件
 */
export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return videoExtensions.has(ext);
}

/**
 * 判断是否为已处理的视频文件
 * @param filePath 文件路径
 * @returns 是否为已处理的视频文件
 */
export function isProcessedVideoFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  const processedPattern = /^.+\-\-\-\d+\.mp4$/;
  return processedPattern.test(fileName);
}

export function insertDirectoryAt(
  path: string,
  newDirName: string,
  position: number
): string {
  // 判断是否是绝对路径（根据原路径）
  const isAbsolute = path.startsWith('/');
  // 规范化路径，去除末尾斜杠
  const normalizedPath = path.replace(/\/+$/, '');
  // 拆分路径
  let parts = normalizedPath.split('/');

  // 处理空路径和根目录拆分后的['']情况
  if (parts.length === 1 && parts[0] === '') {
    parts = [];
  }

  // 如果是绝对路径，去掉第一个空字符串（如果有）
  if (isAbsolute && parts.length > 0 && parts[0] === '') {
    parts = parts.slice(1);
  }

  const len = parts.length;
  let index: number;

  // 计算插入位置
  if (position >= 0) {
    // 正数：从左到右的位置（0表示第一个位置）
    index = Math.min(position, len);
  } else {
    // 负数：从右到左的位置（-1表示最后一个元素之前）
    index = len + position;
    if (index < 0) {
      index = 0;
    }
  }

  // 插入新目录
  parts.splice(index, 0, newDirName);

  // 重新组合路径
  if (isAbsolute) {
    parts.unshift('');
  }
  return parts.join('/');
}

// 便捷函数：在倒数第二处插入（相当于 position = -1）
export function insertDirectoryBeforeLast(
  path: string,
  newDirName: string
): string {
  // 检测是否是 Windows 路径（包含反斜杠或盘符）
  const isWindowsPath = /^[A-Za-z]:\\/.test(path) || path.includes('\\');

  // 统一将反斜杠替换为正斜杠处理
  let normalizedPath = path.replace(/\\/g, '/');

  // 去除路径末尾的斜杠
  normalizedPath = normalizedPath.replace(/\/+$/, '');

  // 拆分路径
  let parts = normalizedPath.split('/');

  // 处理空路径
  if (parts.length === 0) {
    return isWindowsPath ? newDirName.replace(/\//g, '\\') : newDirName;
  }

  // 处理单层路径
  if (parts.length === 1) {
    // Windows 盘符情况（如 "D:"）
    if (/^[A-Za-z]:$/.test(parts[0])) {
      const result = `${parts[0]}/${newDirName}`;
      return isWindowsPath ? result.replace(/\//g, '\\') : result;
    }
    // 普通单层路径（如 "file.txt"）
    const result = `${newDirName}/${parts[0]}`;
    return isWindowsPath ? result.replace(/\//g, '\\') : result;
  }

  // 在倒数第二处插入新目录
  parts.splice(parts.length - 1, 0, newDirName);

  // 重新组合路径
  let result = parts.join('/');

  // 如果是 Windows 路径，转换回反斜杠格式
  if (isWindowsPath) {
    result = result.replace(/\//g, '\\');
  }

  return result;
}

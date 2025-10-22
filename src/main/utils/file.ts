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

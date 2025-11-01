/**
 * 过滤字符串中的特殊字符，使其符合 Windows 文件夹名称规则
 * @param input 原始字符串
 * @returns 过滤后的安全文件夹名称
 */
export function sanitizeFolderName(input: string): string {
  // Windows 文件夹名称不允许的字符集
  const invalidChars = /[\\/:*?"<>|]/g;

  // 替换所有非法字符为空字符串
  let sanitized = input.replace(invalidChars, '');

  // 移除开头和结尾的空格和点（Windows 不允许以空格或点结尾）
  sanitized = sanitized.trim().replace(/^[. ]+|[. ]+$/g, '');

  // 如果结果为空，返回默认名称
  if (!sanitized) {
    return 'UnnamedFolder';
  }

  // 限制长度（Windows 文件夹名称最长 255 字符）
  return sanitized.substring(0, 255);
}

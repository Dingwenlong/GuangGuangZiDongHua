// util/array.ts

/**
 * 数组差异对比结果
 */
export interface ArrayDiffResult<T> {
  /**
   * 新增的元素（在newValue中存在但oldValue中不存在的元素）
   */
  added: T[];
  /**
   * 删除的元素（在oldValue中存在但newValue中不存在的元素）
   */
  removed: T[];
  /**
   * 是否有变化
   */
  hasChanges: boolean;
}

/**
 * 对比两个数组的差异
 * @param newValue 新数组
 * @param oldValue 旧数组
 * @returns 差异对比结果
 */
export function diffArrays<T>(
  newValue: T[],
  oldValue: T[]
): ArrayDiffResult<T> {
  // 转换为Set以提高查找效率
  const newSet = new Set(newValue);
  const oldSet = new Set(oldValue);

  // 找出新增的元素
  const added = newValue.filter(item => !oldSet.has(item));

  // 找出删除的元素
  const removed = oldValue.filter(item => !newSet.has(item));

  return {
    added,
    removed,
    hasChanges: added.length > 0 || removed.length > 0,
  };
}

/**
 * 格式化数组差异信息
 * @param diff 差异对比结果
 * @returns 格式化后的差异信息字符串
 */
export function formatArrayDiff<T>(diff: ArrayDiffResult<T>): string {
  const parts: string[] = [];

  if (diff.added.length > 0) {
    parts.push(`新增: ${diff.added.join(', ')}`);
  }

  if (diff.removed.length > 0) {
    parts.push(`删除: ${diff.removed.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('; ') : '无变化';
}

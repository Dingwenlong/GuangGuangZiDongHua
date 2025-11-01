import { Observable, Subscription, Subject } from 'rxjs';
import { mergeMap, takeUntil, tap } from 'rxjs/operators';

export interface TaskConfig {
  name: string;
  interval: number; // 执行间隔(毫秒)
  concurrency: number; // 最大并发数(默认1)
  enabled?: boolean; // 是否启用(默认true)
}

export interface TaskStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  concurrency: number;
  interval: number;
  lastExecution?: Date;
  nextExecution?: Date;
  executionCount: number;
}

class TaskScheduler {
  private tasks = new Map<
    string,
    {
      config: TaskConfig;
      subscription: Subscription | null;
      stop$: Subject<void>; // 每个任务有自己的stop$ Subject
      runningCount: number;
      executionCount: number;
      lastExecution?: Date;
    }
  >();

  /**
   * 添加任务
   * @param config 任务配置
   * @param taskFn 任务执行函数
   */
  addTask<T>(config: TaskConfig, taskFn: () => Promise<T>): void {
    if (this.tasks.has(config.name)) {
      throw new Error(`Task "${config.name}" already exists`);
    }

    // 创建任务对象，初始化stop$ Subject
    const task = {
      config: { ...config, enabled: config.enabled ?? true },
      subscription: null,
      stop$: new Subject<void>(),
      runningCount: 0,
      executionCount: 0,
    };

    this.tasks.set(config.name, task);

    if (task.config.enabled) {
      this.startTask(config.name, taskFn);
    }
  }

  /**
   * 移除任务
   * @param name 任务名称
   */
  removeTask(name: string): void {
    const task = this.tasks.get(name);
    if (!task) return;

    this.stopTask(name);
    // 完成stop$ Subject，避免内存泄漏
    task.stop$.complete();
    this.tasks.delete(name);
  }

  /**
   * 启动任务
   * @param name 任务名称
   * @param taskFn 任务执行函数
   */
  startTask<T>(name: string, taskFn?: () => Promise<T>): void {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Task "${name}" not found`);
    }

    if (task.subscription) {
      console.warn(`Task "${name}" is already running`);
      return;
    }

    task.config.enabled = true;
    // 如果之前的stop$已经完成，需要重新创建
    if (task.stop$.isStopped) {
      task.stop$ = new Subject<void>();
    }

    // 创建定时器流
    const timer$ = new Observable<void>(subscriber => {
      const intervalId = setInterval(() => {
        subscriber.next();
      }, task.config.interval);

      return () => clearInterval(intervalId);
    });

    // 订阅并处理任务
    task.subscription = timer$
      .pipe(
        tap(() => {
          // 更新最后执行时间
          task.lastExecution = new Date();
        }),
        // 使用 exhaustMap 确保前一个处理完成后再开始下一个
        // 将 exhaustMap(...) 换成 mergeMap(...)
        mergeMap(async () => {
          // 检查并发限制
          if (task.runningCount >= task.config.concurrency) {
            console.log(`Task "${name}" skipped: concurrency limit reached`);
            return Promise.resolve();
          }

          // 增加运行计数
          task.runningCount++;
          task.executionCount++;

          // 执行任务
          try {
            try {
              const result_1 = await (taskFn
                ? taskFn()
                : this.executeTask(name));
              return result_1;
            } catch (error) {
              console.error(`Task "${name}" failed:`, error);
              throw error;
            }
          } finally {
            // 减少运行计数
            task.runningCount--;
          }
        }),
        takeUntil(task.stop$)
      )
      .subscribe({
        error: err => console.error(`Task "${name}" error:`, err),
        complete: () => console.log(`Task "${name}" stopped`),
      });

    console.log(`Task "${name}" started`);
  }

  /**
   * 停止任务
   * @param name 任务名称
   */
  stopTask(name: string): void {
    const task = this.tasks.get(name);
    if (!task || !task.subscription) return;

    task.config.enabled = false;
    // 发出停止信号
    task.stop$.next();
    // 完成stop$ Subject
    task.stop$.complete();
    task.subscription.unsubscribe();
    task.subscription = null;

    console.log(`Task "${name}" stopped`);
  }

  /**
   * 启用任务
   * @param name 任务名称
   */
  enableTask(name: string): void {
    const task = this.tasks.get(name);
    if (!task) return;

    if (!task.config.enabled) {
      task.config.enabled = true;
      console.log(`Task "${name}" enabled`);
    }
  }

  /**
   * 禁用任务
   * @param name 任务名称
   */
  disableTask(name: string): void {
    const task = this.tasks.get(name);
    if (!task) return;

    if (task.config.enabled) {
      task.config.enabled = false;
      console.log(`Task "${name}" disabled`);
    }
  }

  /**
   * 启动所有任务
   */
  startAllTasks(): void {
    this.tasks.forEach((task, name) => {
      if (!task.subscription && task.config.enabled) {
        this.startTask(name);
      }
    });
  }

  /**
   * 停止所有任务
   */
  stopAllTasks(): void {
    this.tasks.forEach((_, name) => {
      this.stopTask(name);
    });
  }

  /**
   * 获取任务状态
   * @param name 任务名称
   */
  getTaskStatus(name: string): TaskStatus | undefined {
    const task = this.tasks.get(name);
    if (!task) return undefined;

    return {
      name: task.config.name,
      enabled: task.config.enabled ?? false,
      running: task.runningCount > 0,
      concurrency: task.config.concurrency,
      interval: task.config.interval,
      lastExecution: task.lastExecution,
      nextExecution: task.lastExecution
        ? new Date(task.lastExecution.getTime() + task.config.interval)
        : undefined,
      executionCount: task.executionCount,
    };
  }

  /**
   * 获取所有任务状态
   */
  getAllTaskStatuses(): TaskStatus[] {
    return Array.from(this.tasks.keys()).map(name => this.getTaskStatus(name)!);
  }

  /**
   * 执行任务（需要子类实现）
   * @param name 任务名称
   */
  protected async executeTask(name: string): Promise<any> {
    throw new Error(`executeTask must be implemented for task "${name}"`);
  }
}

export default TaskScheduler;

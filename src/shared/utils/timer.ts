class Timer {
  /**
   * 延时操作
   * @returns {void}
   * @date 2019-11-25
   */
  public timeout(interval: number, args?: any): Promise<Timer> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(args)
      }, interval)
    })
  }

  /**
   * 等待代码片段执行完毕后再执行
   * @returns {void}
   * @date 2019-11-25
   */
  public inTheEnd(): Promise<Timer> {
    return this.timeout(0)
  }

  /**
   * 循环定时, 执行回调后再继续下一轮循环
   * @param {Number} interval 执行间隔
   * @param {Function} [callback] 回调
   * @date 2019-11-25
   */
  public interval(interval: number, callback: Function) {
    // 定义一个内部函数，用于递归执行
    const run = async () => {
      await this.timeout(interval);
      if (typeof callback === 'function') {
        const result = callback();
        // 如果回调返回的是Promise，等待它完成
        if (result && typeof result.then === 'function') {
          await result;
        }
        if (result !== false) {
          run(); // 递归调用，形成循环
        }
      }
    };
    run();
    // 返回一个对象，允许通过 then 方法设置回调（保持原有接口）
    return { then: (c: Function) => { callback = c; } };
  }

  /**
   * 计时，单位毫秒
   */
  public start() {
    const startDate = new Date()
    return {
      stop() {
        const stopDate = new Date()
        return stopDate.getTime() - startDate.getTime()
      },
    }
  }
}

export default new Timer();

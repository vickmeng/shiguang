/**
 * 通用单飞执行器（与业务无关的后台异步任务原语，future jobs 复用同一原语）。
 *
 * 竞争态处理收敛在 run() 内部：running 置位先于任何 await（JS 单线程同步段
 * 保证「检查→置位」原子），调用方永远不经手 running 标志。计时语义随原语
 * 白送：lastAttemptAt 记录上次尝试开始的 epoch ms（含失败），进程重启即失。
 */

/**
 * 单飞执行器：同一时刻至多一个 fn 在执行。
 *
 * running 时 run() 直接返回 onBusy()（业务自定语义，如幂等 no-op）；否则
 * 同步置 running=true、lastAttemptAt=now（失败同样推进基准），try fn →
 * catch 映射为 opts.onError → finally 无条件复位。
 */
export class SingleFlightRunner {
  private running = false;

  /** 上次尝试开始的 epoch ms（含失败）；进程重启即失。 */
  private lastAttemptAt: number | null = null;

  isRunning(): boolean {
    return this.running;
  }

  getLastAttemptAt(): number | null {
    return this.lastAttemptAt;
  }

  /**
   * 竞争态处理收敛在本方法：running 置位先于任何 await（JS 单线程同步段
   * 保证「检查→置位」原子），调用方永远不经手 running 标志。
   *
   * @param fn 业务异步任务
   * @param opts.onBusy 已在执行时的兜底返回（幂等 no-op 等语义由业务自定）
   * @param opts.onError fn 抛错时映射为业务结果（是否吞错由调用方决定）
   */
  async run<R>(
    fn: () => Promise<R>,
    opts: { onBusy: () => R; onError: (e: Error) => R },
  ): Promise<R> {
    if (this.running) {
      return opts.onBusy();
    }
    this.running = true;
    this.lastAttemptAt = Date.now();
    try {
      return await fn();
    } catch (e) {
      return opts.onError(e as Error);
    } finally {
      this.running = false;
    }
  }
}

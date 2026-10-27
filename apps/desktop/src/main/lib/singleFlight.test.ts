/**
 * SingleFlightRunner 单测：验证通用单飞执行器的竞争态收敛语义。
 *
 * 核心易错点：「检查→置位」必须在同一同步段完成（running 置位先于任何
 * await），因此执行期（fn 悬挂未决）的第二次 run 必须走 onBusy 且 fn 不得
 * 再执行；finally 无条件复位（reject 后仍可再进 fn）；lastAttemptAt 在调用
 * 时推进，失败同样推进（计时语义含失败尝试）。
 */
import { describe, expect, it, vi } from 'vitest';
import { SingleFlightRunner } from './singleFlight';

/** 可控 promise：使 fn 悬挂，模拟「执行期」竞争窗口。 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlightRunner.run', () => {
  it('fn resolve：返回其结果', async () => {
    const runner = new SingleFlightRunner();
    const result = await runner.run(() => Promise.resolve('ok'), {
      onBusy: () => 'busy',
      onError: () => 'err',
    });
    expect(result).toBe('ok');
  });

  it('执行期第二次 run 走 onBusy 且 fn 未再执行（用可控 promise 使 fn 悬挂）', async () => {
    const runner = new SingleFlightRunner();
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);

    const first = runner.run(fn, { onBusy: () => 'busy', onError: () => 'err' });
    const second = await runner.run(fn, { onBusy: () => 'busy', onError: () => 'err' });

    expect(second).toBe('busy');
    expect(fn).toHaveBeenCalledTimes(1);

    d.resolve('done');
    await expect(first).resolves.toBe('done');
  });

  it('fn reject：走 onError 且其结果被返回', async () => {
    const runner = new SingleFlightRunner();
    const onError = vi.fn((e: Error) => `err:${e.message}`);
    const result = await runner.run(() => Promise.reject(new Error('boom')), {
      onBusy: () => 'busy',
      onError,
    });
    expect(result).toBe('err:boom');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('finally 复位：reject 后第三次 run 可再进 fn', async () => {
    const runner = new SingleFlightRunner();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('retry-ok');
    const opts = { onBusy: () => 'busy', onError: (e: Error) => `err:${e.message}` };

    await expect(runner.run(fn, opts)).resolves.toBe('err:boom');
    expect(runner.isRunning()).toBe(false);

    await expect(runner.run(fn, opts)).resolves.toBe('retry-ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('lastAttemptAt 在调用时推进（失败也推进）', async () => {
    const runner = new SingleFlightRunner();
    expect(runner.getLastAttemptAt()).toBeNull();

    await runner.run(() => Promise.resolve(1), { onBusy: () => 0, onError: () => 0 });
    const afterOk = runner.getLastAttemptAt();
    expect(afterOk).not.toBeNull();

    await runner.run(() => Promise.reject(new Error('x')), { onBusy: () => 0, onError: () => 0 });
    const afterFail = runner.getLastAttemptAt();
    expect(afterFail).not.toBeNull();
    expect(afterFail!).toBeGreaterThanOrEqual(afterOk!);
  });
});

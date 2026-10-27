/**
 * profileHandlers 单测：验证画像系统两条 IPC 通道的胶水转发契约
 * （AC-2、AC-7）。
 *
 * 两通道与底层一一对应、零编排：
 *  - profile:get       → { document, updatedAt, pendingCount, running }
 *                        （document/updatedAt 取自 profileDao.getProfile，
 *                        无画像行时为 null；pendingCount 取 profileDao.pendingCount；
 *                        running 取 profileRunner.isRunning）
 *  - profile:summarize → summarizeNow()（resolve 值原样透出，幂等 no-op
 *                        语义由 profileRunner 单飞保证）
 *
 * mock electron 的 ipcMain（handle 捕获注册）、@shiguang/ai 的
 * profileDao 两函数与 ../profile/profileRunner 的两函数（DAO 与 runner
 * 真行为分别由 profileDao.test.ts 与 profileRunner.test.ts 覆盖），
 * 只断言本层的「通道存在 + 载荷四字段与 mock 一致」。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IPC } from '@shiguang/shared';
import type { ProfileDocument, ProfileSummarizeResult } from '@shiguang/shared';

const { stubs, dao, runner } = vi.hoisted(() => ({
  stubs: {
    ipcMain: {
      removeAllListeners: vi.fn(),
      on: vi.fn(),
      handle: vi.fn(),
    },
  },
  dao: {
    getProfile: vi.fn(),
    pendingCount: vi.fn(),
  },
  runner: {
    isRunning: vi.fn(),
    summarizeNow: vi.fn(),
  },
}));

vi.mock('electron', () => ({ ipcMain: stubs.ipcMain }));
vi.mock('@shiguang/ai', () => ({
  getProfile: dao.getProfile,
  pendingCount: dao.pendingCount,
}));
vi.mock('../profile/profileRunner', () => ({
  isRunning: runner.isRunning,
  summarizeNow: runner.summarizeNow,
}));

import { registerProfileHandlers } from './profileHandlers';

const DOCUMENT: ProfileDocument = {
  identity: ['后端工程师'],
  recent: ['在重构记录页'],
  interests: ['钓鱼'],
  values: ['厌恶重复劳动'],
  goals: ['做独立产品'],
  misc: [],
};

/** 取出指定通道的 invoke handler（先注册再捕获）。 */
function handlerOf<T extends unknown[], R>(channel: string): (...args: T) => R {
  registerProfileHandlers();
  const call = stubs.ipcMain.handle.mock.calls.find((c) => c[0] === channel);
  expect(call, `通道 ${channel} 应注册`).toBeDefined();
  return call![1] as (...args: T) => R;
}

describe('profileHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('两通道全部注册（profile:get / profile:summarize）', () => {
    registerProfileHandlers();
    const channels = stubs.ipcMain.handle.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([IPC.profileGet, IPC.profileSummarize]),
    );
  });

  it('profile:get → 载荷四字段与 mock 一致', async () => {
    dao.getProfile.mockReturnValue({ document: DOCUMENT, updatedAt: '2026-10-27T08:00:00.000Z' });
    dao.pendingCount.mockReturnValue(3);
    runner.isRunning.mockReturnValue(false);
    const handler = handlerOf<[unknown], unknown>(IPC.profileGet);

    expect(handler({})).toEqual({
      document: DOCUMENT,
      updatedAt: '2026-10-27T08:00:00.000Z',
      pendingCount: 3,
      running: false,
    });
    expect(dao.getProfile).toHaveBeenCalledTimes(1);
    expect(dao.pendingCount).toHaveBeenCalledTimes(1);
    expect(runner.isRunning).toHaveBeenCalledTimes(1);
  });

  it('profile:get → 无画像行时 document/updatedAt 为 null', async () => {
    dao.getProfile.mockReturnValue(null);
    dao.pendingCount.mockReturnValue(0);
    runner.isRunning.mockReturnValue(true);
    const handler = handlerOf<[unknown], unknown>(IPC.profileGet);

    expect(handler({})).toEqual({
      document: null,
      updatedAt: null,
      pendingCount: 0,
      running: true,
    });
  });

  it('profile:summarize → summarizeNow()，resolve 值原样透出', async () => {
    const result: ProfileSummarizeResult = { ok: true };
    runner.summarizeNow.mockReturnValue(Promise.resolve(result));
    const handler = handlerOf<[unknown], Promise<ProfileSummarizeResult>>(IPC.profileSummarize);

    await expect(handler({})).resolves.toBe(result);
    expect(runner.summarizeNow).toHaveBeenCalledTimes(1);
  });

  it('profile:summarize → 汇总失败时 invoke 自然 reject（resolve 值透出语义）', async () => {
    runner.summarizeNow.mockReturnValue(
      Promise.resolve({ ok: false, error: 'KIMI_API_KEY 未配置' }),
    );
    const handler = handlerOf<[unknown], Promise<ProfileSummarizeResult>>(IPC.profileSummarize);

    await expect(handler({})).resolves.toEqual({ ok: false, error: 'KIMI_API_KEY 未配置' });
  });
});

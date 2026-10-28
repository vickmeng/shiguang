/**
 * profileRunner 单测：验证画像汇总的自动触发判定（AC-1/AC-3）与
 * 手动入口/定时器语义（AC-2/AC-6）。
 *
 * mock @shiguang/ai 的 profileDao（getProfile/pendingCount/pendingSummaries/
 * saveProfileWithStamp）与 profiler（runProfileSummarization），DAO 与 Agent
 * 真行为分别由 packages/ai 侧测试覆盖，此处只测触发编排：
 *  - 待汇总 ≥5 条：无视距上次间隔直接触发（generate+save 各一次）；
 *  - 距上次尝试 ≥24h 且有积压（≥1 条）：触发；<24h：不触发；
 *  - profiles 无行（从未汇总过）且 ≥1 条：首次首跑触发；
 *  - 单飞：running 中再调 maybeSummarize 不触发第二次；
 *  - 失败语义：触发失败 console.error 留痕、save 未调、maybeSummarize 不抛
 *    （fire-and-forget，绝不阻塞记录入库方）；
 *  - 手动入口 summarizeNow：成功 resolve { ok: true }；reject 返回
 *    { ok: false, error: 消息 } 且 save 未调、running 复位（可再触发）；
 *    running 期间幂等返回 { ok: true } 且不再调 profiler；
 *  - 成功后 lastAttemptAt 推进：pending=1 且距上次 <24h 不再触发；
 *  - 定时器 startProfileTimer：setInterval 以 600_000ms 注册，回调经
 *    maybeSummarize 判定触发。
 *
 * 「距上次」基准 = summarizeJob.lastAttemptAt（内存，含失败）?? profiles.updated_at
 * （epoch）；每个用例经 vi.resetModules 重取模块，获得全新模块级 summarizeJob。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSummary, RecentMention } from '@shiguang/ai';
import type { ProfileDocument } from '@shiguang/shared';

const stubs = vi.hoisted(() => ({
  getProfile: vi.fn(),
  pendingCount: vi.fn(),
  pendingSummaries: vi.fn(),
  recentMentions: vi.fn(),
  runProfileSummarization: vi.fn(),
  saveProfileWithStamp: vi.fn(),
}));

vi.mock('@shiguang/ai', () => ({
  getProfile: stubs.getProfile,
  pendingCount: stubs.pendingCount,
  pendingSummaries: stubs.pendingSummaries,
  recentMentions: stubs.recentMentions,
  runProfileSummarization: stubs.runProfileSummarization,
  saveProfileWithStamp: stubs.saveProfileWithStamp,
}));

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DOCUMENT: ProfileDocument = {
  identity: '用户是开发者',
  recent: null,
  interests: null,
  values: null,
  goals: null,
  misc: null,
};

const LATEST: PendingSummary[] = [1, 2, 3, 4, 5].map((recordId) => ({
  recordId,
  summary: `摘要${recordId}`,
  grade: recordId % 2 === 0 ? 'high' : null,
  tags: ['标签'],
  createdAt: '2026-10-01T00:00:00.000Z',
}));

const RECENT: RecentMention[] = [
  {
    recordId: 9,
    createdAt: '2026-10-21T09:00:00.000Z',
    grade: 'high',
    tags: ['标签'],
    summary: '摘要9',
    analyzed: true,
  },
];

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** 每个用例重取模块，模块级 summarizeJob（running/lastAttemptAt）归零。 */
async function freshRunner(): Promise<typeof import('./profileRunner')> {
  vi.resetModules();
  return await import('./profileRunner');
}

/** 等一个事件循环，确认 fire-and-forget 未触发任何调用。 */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('maybeSummarize 触发判定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.pendingSummaries.mockReturnValue(LATEST);
    stubs.recentMentions.mockReturnValue(RECENT);
    stubs.runProfileSummarization.mockResolvedValue(DOCUMENT);
  });

  it('pending=5：触发一次 generate+save（save 入参 document 与全批 stampedIds）', async () => {
    stubs.pendingCount.mockReturnValue(5);
    stubs.getProfile.mockReturnValue({ document: DOCUMENT, updatedAt: isoAgo(2 * DAY_MS) });
    const runner = await freshRunner();

    runner.maybeSummarize();

    await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1));
    expect(stubs.runProfileSummarization).toHaveBeenCalledWith({
      previous: DOCUMENT,
      latest: LATEST,
      recent: RECENT,
    });
    await vi.waitFor(() => expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1));
    expect(stubs.saveProfileWithStamp).toHaveBeenCalledWith({
      document: DOCUMENT,
      stampedIds: [1, 2, 3, 4, 5],
    });
  });

  it('pending=1 且距上次（mock updatedAt）≥24h：触发', async () => {
    stubs.pendingCount.mockReturnValue(1);
    stubs.getProfile.mockReturnValue({ document: DOCUMENT, updatedAt: isoAgo(25 * HOUR_MS) });
    const runner = await freshRunner();

    runner.maybeSummarize();

    await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1));
    expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1);
  });

  it('pending=1 且距上次（mock updatedAt）<24h：不触发', async () => {
    stubs.pendingCount.mockReturnValue(1);
    stubs.getProfile.mockReturnValue({ document: DOCUMENT, updatedAt: isoAgo(1 * HOUR_MS) });
    const runner = await freshRunner();

    runner.maybeSummarize();
    await tick();

    expect(stubs.runProfileSummarization).not.toHaveBeenCalled();
    expect(stubs.saveProfileWithStamp).not.toHaveBeenCalled();
  });

  it('profiles 无行（mock getProfile 返 null）且 pending=1：首次首跑触发', async () => {
    stubs.pendingCount.mockReturnValue(1);
    stubs.getProfile.mockReturnValue(null);
    const runner = await freshRunner();

    runner.maybeSummarize();

    await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1));
    expect(stubs.runProfileSummarization).toHaveBeenCalledWith({
      previous: null,
      latest: LATEST,
      recent: RECENT,
    });
  });

  it('running 中（先悬挂的 summarizeNow 制造）再调 maybeSummarize：不触发第二次（单飞）', async () => {
    stubs.pendingCount.mockReturnValue(5);
    stubs.getProfile.mockReturnValue(null);
    let resolveGenerate!: (doc: ProfileDocument) => void;
    stubs.runProfileSummarization.mockImplementation(
      () =>
        new Promise<ProfileDocument>((resolve) => {
          resolveGenerate = resolve;
        }),
    );
    const runner = await freshRunner();

    runner.maybeSummarize();
    await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1));
    expect(runner.isRunning()).toBe(true);

    // 执行期再来触发（模拟 capture 钩子同刻到达）：快速短路，不产生第二次 LLM 调用
    runner.maybeSummarize();
    await tick();
    expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1);

    resolveGenerate(DOCUMENT);
    await vi.waitFor(() => expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1));
    expect(runner.isRunning()).toBe(false);
  });

  it('触发失败：console.error 留痕、save 未调、maybeSummarize 不抛', async () => {
    stubs.pendingCount.mockReturnValue(5);
    stubs.getProfile.mockReturnValue(null);
    stubs.runProfileSummarization.mockRejectedValue(new Error('网络超时'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = await freshRunner();

    expect(() => runner.maybeSummarize()).not.toThrow();

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy.mock.calls[0].join(' ')).toContain('网络超时');
    expect(stubs.saveProfileWithStamp).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('summarizeNow 手动入口（AC-2/AC-6）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.pendingSummaries.mockReturnValue(LATEST);
    stubs.recentMentions.mockReturnValue(RECENT);
    stubs.runProfileSummarization.mockResolvedValue(DOCUMENT);
  });

  it('正常路径：resolve { ok: true }，save 入参 document 与全批 stampedIds', async () => {
    const runner = await freshRunner();

    await expect(runner.summarizeNow()).resolves.toEqual({ ok: true });

    expect(stubs.runProfileSummarization).toHaveBeenCalledWith({
      previous: null,
      latest: LATEST,
      recent: RECENT,
    });
    expect(stubs.saveProfileWithStamp).toHaveBeenCalledWith({
      document: DOCUMENT,
      stampedIds: [1, 2, 3, 4, 5],
    });
    expect(runner.isRunning()).toBe(false);
  });

  it('profiler reject：返回 { ok:false, error:消息 }，save 未调、running 复位（可再触发）', async () => {
    stubs.runProfileSummarization.mockRejectedValue(new Error('schema 校验失败'));
    stubs.pendingCount.mockReturnValue(5);
    stubs.getProfile.mockReturnValue(null);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = await freshRunner();

    await expect(runner.summarizeNow()).resolves.toEqual({
      ok: false,
      error: 'schema 校验失败',
    });
    expect(stubs.saveProfileWithStamp).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(false);

    // running 复位 + 失败同样推进 lastAttemptAt；pending>=5 规则不受间隔限制，可再触发
    stubs.runProfileSummarization.mockResolvedValue(DOCUMENT);
    runner.maybeSummarize();
    await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1));
    errorSpy.mockRestore();
  });

  it('running 期间（先悬挂一个 summarizeNow）调 summarizeNow：幂等返回 { ok:true }，profiler 未被调', async () => {
    let resolveGenerate!: (doc: ProfileDocument) => void;
    stubs.runProfileSummarization.mockImplementation(
      () =>
        new Promise<ProfileDocument>((resolve) => {
          resolveGenerate = resolve;
        }),
    );
    const runner = await freshRunner();

    const first = runner.summarizeNow();
    await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1));

    await expect(runner.summarizeNow()).resolves.toEqual({ ok: true });
    expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1);

    resolveGenerate(DOCUMENT);
    await expect(first).resolves.toEqual({ ok: true });
    expect(runner.isRunning()).toBe(false);
  });

  it('成功后 lastAttemptAt 推进：pending=1 且距上次 <24h 不再触发', async () => {
    stubs.pendingCount.mockReturnValue(1);
    stubs.getProfile.mockReturnValue({ document: DOCUMENT, updatedAt: isoAgo(2 * DAY_MS) });
    const runner = await freshRunner();

    await expect(runner.summarizeNow()).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1));

    // 成功即推进 lastAttemptAt=now，此后距上次仅 0ms <24h，即使仍有积压也不触发
    runner.maybeSummarize();
    await tick();
    expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1);
    expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1);
  });
});

describe('startProfileTimer（AC-2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.pendingSummaries.mockReturnValue(LATEST);
    stubs.recentMentions.mockReturnValue(RECENT);
    stubs.runProfileSummarization.mockResolvedValue(DOCUMENT);
  });

  it('setInterval 以 600_000ms 注册，回调经 maybeSummarize 判定触发', async () => {
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
    stubs.pendingCount.mockReturnValue(5);
    stubs.getProfile.mockReturnValue(null);
    const runner = await freshRunner();

    try {
      runner.startProfileTimer();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 600_000);

      // 取出回调手动驱动一次：确认走 maybeSummarize 判定（pending=5 触发）
      const callback = setIntervalSpy.mock.calls[0][0] as () => void;
      callback();
      await vi.waitFor(() => expect(stubs.runProfileSummarization).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(stubs.saveProfileWithStamp).toHaveBeenCalledTimes(1));
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});

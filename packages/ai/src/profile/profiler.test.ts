/**
 * profiler.test.ts — 画像汇总 Agent 构造、系统提示词、strict schema 与
 * runProfileSummarization（输入拼装 + generate 调用 + 配置闸门）单测。
 *
 * vi.mock('@mastra/core/agent') 打桩 Agent：agentConfigs 捕获 Agent 构造入参
 * （注意：profiler 复用 import summarizer 的 resolveKimiModel，summarizer 模块
 * 级 Agent 同样经打桩构造，故按 id 过滤出 user-profiler 的构造记录）。
 * 模块经 vi.resetModules() 逐用例重载，保证构造记录相互隔离。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock, agentConfigs } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  agentConfigs: [] as Array<Record<string, unknown>>,
}));

vi.mock('@mastra/core/agent', () => ({
  Agent: class Agent {
    generate = generateMock;
    constructor(config: Record<string, unknown>) {
      agentConfigs.push(config);
    }
  },
}));

type ProfilerModule = typeof import('./profiler');

async function loadProfiler(): Promise<ProfilerModule> {
  return import('./profiler');
}

function profilerAgentConfig(): Record<string, unknown> {
  const config = agentConfigs.find((c) => c.id === 'user-profiler');
  expect(config, 'user-profiler Agent 构造记录应存在').toBeDefined();
  return config as Record<string, unknown>;
}

describe('PROFILER_SYSTEM_PROMPT（design 3.2 要点）', () => {
  beforeEach(() => {
    vi.resetModules();
    agentConfigs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('含全量重写指令：新的 ProfileDocument、严格按格式输出', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    expect(PROFILER_SYSTEM_PROMPT).toContain('全量重写');
    expect(PROFILER_SYSTEM_PROMPT).toContain('新的 ProfileDocument');
    expect(PROFILER_SYSTEM_PROMPT).toContain('严格按照规定格式输出');
  });

  it('含输出约束：严格 JSON、空槽为正常结果', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    expect(PROFILER_SYSTEM_PROMPT).toContain('严格 JSON');
    expect(PROFILER_SYSTEM_PROMPT).toContain('宁缺毋滥');
    expect(PROFILER_SYSTEM_PROMPT).toContain('为空是正常结果');
  });

  it('含三部分输入结构说明关键词', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    expect(PROFILER_SYSTEM_PROMPT).toContain('previous');
    expect(PROFILER_SYSTEM_PROMPT).toContain('新摘要');
    expect(PROFILER_SYSTEM_PROMPT).toContain('历史摘要');
    expect(PROFILER_SYSTEM_PROMPT).toContain('summary');
    // 旧表述全部移除：analyzed 标志、仅元数据、活跃度判断、batch 旧名
    expect(PROFILER_SYSTEM_PROMPT).not.toContain('analyzed');
    expect(PROFILER_SYSTEM_PROMPT).not.toContain('仅元数据');
    expect(PROFILER_SYSTEM_PROMPT).not.toContain('活跃度');
    expect(PROFILER_SYSTEM_PROMPT).not.toContain('batch');
  });

  it('逐条定义 5+1 槽位语义且 key 与 ProfileDocument 一致', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    for (const slot of ['identity', 'recent', 'interests', 'values', 'goals', 'misc']) {
      expect(PROFILER_SYSTEM_PROMPT).toContain(`${slot}?: string | null`);
    }
    // 槽位语义关键词（design 3.2 表）：身份事实 / 近期关注 / 兴趣 / 价值观 / 长期目标
    expect(PROFILER_SYSTEM_PROMPT).toContain('职业');
    expect(PROFILER_SYSTEM_PROMPT).toContain('反复提及');
    expect(PROFILER_SYSTEM_PROMPT).toContain('价值观');
    expect(PROFILER_SYSTEM_PROMPT).toContain('长期目标');
  });

  it('含输入 interface 结构说明：字段类型与可空性', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    expect(PROFILER_SYSTEM_PROMPT).toContain('interface Input');
    expect(PROFILER_SYSTEM_PROMPT).toContain('previous: ProfileDocument');
    expect(PROFILER_SYSTEM_PROMPT).toContain('latest: SummaryItem[]');
    expect(PROFILER_SYSTEM_PROMPT).toContain('recent: SummaryItem[]');
    expect(PROFILER_SYSTEM_PROMPT).toContain('createdAt: string');
    expect(PROFILER_SYSTEM_PROMPT).toContain('grade: string | null');
    expect(PROFILER_SYSTEM_PROMPT).toContain('tags: string[]');
    expect(PROFILER_SYSTEM_PROMPT).toContain('summary: string');
    expect(PROFILER_SYSTEM_PROMPT).not.toContain('recordId');
    expect(PROFILER_SYSTEM_PROMPT).not.toContain('勿写入画像');
  });
});

describe('profileOutputSchema（zod .strict()）', () => {
  beforeEach(() => {
    vi.resetModules();
    agentConfigs.length = 0;
  });

  it('6 槽位全 null 对象通过且原样透传', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(
      profileOutputSchema.parse({
        identity: null,
        recent: null,
        interests: null,
        values: null,
        goals: null,
        misc: null,
      }),
    ).toEqual({ identity: null, recent: null, interests: null, values: null, goals: null, misc: null });
  });

  it('缺槽位对象不再抛错：原样透传（缺槽视同无内容）', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(
      profileOutputSchema.parse({
        identity: '用户是开发者',
        recent: null,
        interests: null,
        values: null,
        goals: null,
      }),
    ).toEqual({ identity: '用户是开发者', recent: null, interests: null, values: null, goals: null });
  });

  it('槽位混合 string / null 原样透传', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(
      profileOutputSchema.parse({
        identity: '程序员',
        recent: null,
        interests: '徒步与摄影',
        values: null,
        goals: '成为独立开发者',
        misc: null,
      }),
    ).toEqual({
      identity: '程序员',
      recent: null,
      interests: '徒步与摄影',
      values: null,
      goals: '成为独立开发者',
      misc: null,
    });
  });

  it('多 extra 槽位对象抛错（strict：多余槽位即解析失败）', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(() =>
      profileOutputSchema.parse({
        identity: null,
        recent: null,
        interests: null,
        values: null,
        goals: null,
        misc: null,
        extra: null,
      }),
    ).toThrow();
  });

  it('槽位非字符串（如数字、数组）抛错', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(() =>
      profileOutputSchema.parse({
        identity: 42,
        recent: null,
        interests: null,
        values: null,
        goals: null,
        misc: null,
      }),
    ).toThrow();
    expect(() =>
      profileOutputSchema.parse({
        identity: ['程序员'],
        recent: null,
        interests: null,
        values: null,
        goals: null,
        misc: null,
      }),
    ).toThrow();
  });
});

describe('profilerAgent 构造（复用 summarizer 模型接入模式）', () => {
  beforeEach(() => {
    vi.resetModules();
    agentConfigs.length = 0;
    process.env.KIMI_API_KEY = 'test-kimi-key';
  });

  afterEach(() => {
    delete process.env.KIMI_API_KEY;
    delete process.env.KIMI_MODEL;
    vi.restoreAllMocks();
  });

  it('Agent id 为 user-profiler，instructions 与 PROFILER_SYSTEM_PROMPT 一致', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    const config = profilerAgentConfig();
    expect(config.id).toBe('user-profiler');
    expect(config.instructions).toBe(PROFILER_SYSTEM_PROMPT);
  });

  it('model 为 custom endpoint 配置且惰性求值（KIMI_MODEL 覆盖在求值时生效）', async () => {
    const { resolveKimiModel } = await import('../analysis/summarizer');
    await loadProfiler();

    const model = profilerAgentConfig().model as () => Record<string, unknown>;
    expect(model()).toEqual({
      id: 'custom/kimi-k2.6',
      url: 'https://api.kimi.com/coding/v1',
      apiKey: 'test-kimi-key',
    });

    process.env.KIMI_MODEL = 'kimi-custom-model';
    expect(resolveKimiModel()).toBe('kimi-custom-model');
    expect((model() as { id: string }).id).toBe('custom/kimi-custom-model');
  });
});

describe('runProfileSummarization（输入拼装 + structured output 调用）', () => {
  const previous = {
    identity: '程序员',
    recent: null,
    interests: null,
    values: null,
    goals: null,
    misc: null,
  };

  const latest = [
    {
      recordId: 1,
      summary: '最近在调研备忘录应用的 AI 摘要方案',
      grade: 'high',
      tags: ['工作', 'AI'],
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    {
      recordId: 2,
      summary: '周末去了趟植物园',
      grade: null,
      tags: [],
      createdAt: '2026-10-21T09:00:00.000Z',
    },
  ];

  /** 近期记录概览输入（dao 已倒序，含摘要全文），按传入顺序原样输出 */
  const recent: import('../dao/profileDao').RecentMention[] = [
    {
      recordId: 13,
      createdAt: '2026-10-21T09:00:00.000Z',
      grade: null,
      tags: [],
      summary: '周末去了趟植物园',
      analyzed: false,
    },
    {
      recordId: 12,
      createdAt: '2026-10-20T10:00:00.000Z',
      grade: 'high',
      tags: ['工作', 'AI'],
      summary: '最近在调研备忘录应用的 AI 摘要方案',
      analyzed: true,
    },
  ];

  beforeEach(() => {
    vi.resetModules();
    agentConfigs.length = 0;
    generateMock.mockReset();
    process.env.KIMI_API_KEY = 'test-kimi-key';
  });

  afterEach(() => {
    delete process.env.KIMI_API_KEY;
    vi.restoreAllMocks();
  });

  it('generate 返回 6 槽位对象时 resolve 为 ProfileDocument', async () => {
    const document = {
      identity: '程序员',
      recent: '调研 AI 摘要方案',
      interests: null,
      values: null,
      goals: null,
      misc: null,
    };
    generateMock.mockResolvedValue({ object: document });
    const { runProfileSummarization } = await loadProfiler();

    const result = await runProfileSummarization({ previous, latest, recent });

    expect(result).toEqual(document);
  });

  it('generate 返回缺槽对象时 resolve：缺槽原样透传（不再视同失败）', async () => {
    generateMock.mockResolvedValue({
      object: { identity: '程序员', recent: null, interests: null, values: null, goals: null },
    });
    const { runProfileSummarization } = await loadProfiler();

    await expect(runProfileSummarization({ previous, latest, recent })).resolves.toEqual({
      identity: '程序员',
      recent: null,
      interests: null,
      values: null,
      goals: null,
    });
  });

  it('user content 为 JSON：recent 按传入顺序原样输出（剔除 recordId / analyzed）', async () => {
    generateMock.mockResolvedValue({ object: previous });
    const { runProfileSummarization } = await loadProfiler();

    await runProfileSummarization({ previous, latest, recent });

    expect(generateMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(generateMock.mock.calls[0][0] as string);
    expect(payload.recent).toEqual([
      {
        createdAt: '2026-10-21T09:00:00.000Z',
        grade: null,
        tags: [],
        summary: '周末去了趟植物园',
      },
      {
        createdAt: '2026-10-20T10:00:00.000Z',
        grade: 'high',
        tags: ['工作', 'AI'],
        summary: '最近在调研备忘录应用的 AI 摘要方案',
      },
    ]);
  });

  it('user content 为 JSON：previous 为旧画像对象，latest/recent 元素无 recordId；无旧画像时为 {}（不再注入「尚无画像」）', async () => {
    generateMock.mockResolvedValue({ object: previous });
    const { runProfileSummarization } = await loadProfiler();

    await runProfileSummarization({ previous, latest, recent });

    expect(generateMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(generateMock.mock.calls[0][0] as string);
    expect(payload.previous).toEqual(previous);
    for (const item of payload.latest) {
      expect(item).not.toHaveProperty('recordId');
    }

    generateMock.mockClear();
    await runProfileSummarization({ previous: null, latest, recent });

    const nullPayload = JSON.parse(generateMock.mock.calls[0][0] as string);
    expect(nullPayload.previous).toEqual({});
    expect(generateMock.mock.calls[0][0]).not.toContain('尚无画像');
  });

  it('KIMI_API_KEY 未配置时 reject，error 含配置指引', async () => {
    delete process.env.KIMI_API_KEY;
    generateMock.mockResolvedValue({ object: previous });
    const { runProfileSummarization } = await loadProfiler();

    await expect(runProfileSummarization({ previous, latest, recent })).rejects.toThrow(
      '请设置 KIMI_API_KEY 环境变量',
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('generate 以 structuredOutput schema 与 60s 超时调用', async () => {
    generateMock.mockResolvedValue({ object: previous });
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const { runProfileSummarization, profileOutputSchema } = await loadProfiler();

    await runProfileSummarization({ previous, latest, recent });

    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    const options = generateMock.mock.calls[0][1] as {
      structuredOutput: { schema: unknown };
      abortSignal: AbortSignal;
    };
    expect(options.structuredOutput.schema).toBe(profileOutputSchema);
    expect(options.abortSignal).toBeDefined();
  });
});

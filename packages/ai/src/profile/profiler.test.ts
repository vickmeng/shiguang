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

  it('含全量重写指令：全新画像、淘汰或改写', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    expect(PROFILER_SYSTEM_PROMPT).toContain('全新画像');
    expect(PROFILER_SYSTEM_PROMPT).toContain('淘汰或改写');
  });

  it('含槽位约束：不允许发明新槽位、空数组、严格 JSON', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    expect(PROFILER_SYSTEM_PROMPT).toContain('不允许发明新槽位');
    expect(PROFILER_SYSTEM_PROMPT).toContain('空数组');
    expect(PROFILER_SYSTEM_PROMPT).toContain('严格 JSON');
  });

  it('逐条定义 5+1 槽位语义且 key 与 ProfileDocument 一致', async () => {
    const { PROFILER_SYSTEM_PROMPT } = await loadProfiler();

    for (const slot of ['identity', 'recent', 'interests', 'values', 'goals', 'misc']) {
      expect(PROFILER_SYSTEM_PROMPT).toContain(slot);
    }
    // 槽位语义关键词（design 3.2 表）：身份事实 / 近期关注 / 兴趣 / 价值观 / 长期目标
    expect(PROFILER_SYSTEM_PROMPT).toContain('职业');
    expect(PROFILER_SYSTEM_PROMPT).toContain('反复提及');
    expect(PROFILER_SYSTEM_PROMPT).toContain('价值观');
    expect(PROFILER_SYSTEM_PROMPT).toContain('长期目标');
  });
});

describe('profileOutputSchema（zod .strict()）', () => {
  beforeEach(() => {
    vi.resetModules();
    agentConfigs.length = 0;
  });

  it('6 槽位全空数组对象通过', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(
      profileOutputSchema.parse({
        identity: [],
        recent: [],
        interests: [],
        values: [],
        goals: [],
        misc: [],
      }),
    ).toEqual({ identity: [], recent: [], interests: [], values: [], goals: [], misc: [] });
  });

  it('缺 misc 槽位对象抛错（缺槽=失败）', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(() =>
      profileOutputSchema.parse({
        identity: [],
        recent: [],
        interests: [],
        values: [],
        goals: [],
      }),
    ).toThrow();
  });

  it('多 extra 槽位对象抛错（strict：多余槽位即解析失败）', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(() =>
      profileOutputSchema.parse({
        identity: [],
        recent: [],
        interests: [],
        values: [],
        goals: [],
        misc: [],
        extra: [],
      }),
    ).toThrow();
  });

  it('槽位元素非字符串（如数字）抛错', async () => {
    const { profileOutputSchema } = await loadProfiler();

    expect(() =>
      profileOutputSchema.parse({
        identity: [42],
        recent: [],
        interests: [],
        values: [],
        goals: [],
        misc: [],
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
    identity: ['程序员'],
    recent: [],
    interests: [],
    values: [],
    goals: [],
    misc: [],
  };

  const batch = [
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
      identity: ['程序员'],
      recent: ['调研 AI 摘要方案'],
      interests: [],
      values: [],
      goals: [],
      misc: [],
    };
    generateMock.mockResolvedValue({ object: document });
    const { runProfileSummarization } = await loadProfiler();

    const result = await runProfileSummarization({ previous, batch });

    expect(result).toEqual(document);
  });

  it('generate 返回缺槽对象时 reject（schema 校验失败自然抛错，不 catch）', async () => {
    generateMock.mockResolvedValue({
      object: { identity: [], recent: [], interests: [], values: [], goals: [] },
    });
    const { runProfileSummarization } = await loadProfiler();

    await expect(runProfileSummarization({ previous, batch })).rejects.toThrow();
  });

  it('user content 含旧画像 JSON、尚无画像注明与 #编号 列表格式', async () => {
    generateMock.mockResolvedValue({ object: previous });
    const { runProfileSummarization } = await loadProfiler();

    await runProfileSummarization({ previous, batch });

    expect(generateMock).toHaveBeenCalledTimes(1);
    const userContent = generateMock.mock.calls[0][0] as string;
    expect(userContent).toContain(JSON.stringify(previous));
    expect(userContent).toContain('#1 [2026-10-20T10:00:00.000Z] (grade: high) 标签：工作、AI');
    expect(userContent).toContain('#2 [2026-10-21T09:00:00.000Z] (grade: none) 标签：');
    expect(userContent).toContain('最近在调研备忘录应用的 AI 摘要方案');

    generateMock.mockClear();
    await runProfileSummarization({ previous: null, batch });

    const nullContent = generateMock.mock.calls[0][0] as string;
    expect(nullContent).toContain('尚无画像');
    expect(nullContent).not.toContain(JSON.stringify(previous));
  });

  it('KIMI_API_KEY 未配置时 reject，error 含配置指引', async () => {
    delete process.env.KIMI_API_KEY;
    generateMock.mockResolvedValue({ object: previous });
    const { runProfileSummarization } = await loadProfiler();

    await expect(runProfileSummarization({ previous, batch })).rejects.toThrow(
      '请设置 KIMI_API_KEY 环境变量',
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('generate 以 structuredOutput schema 与 60s 超时调用', async () => {
    generateMock.mockResolvedValue({ object: previous });
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const { runProfileSummarization, profileOutputSchema } = await loadProfiler();

    await runProfileSummarization({ previous, batch });

    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    const options = generateMock.mock.calls[0][1] as {
      structuredOutput: { schema: unknown };
      abortSignal: AbortSignal;
    };
    expect(options.structuredOutput.schema).toBe(profileOutputSchema);
    expect(options.abortSignal).toBeDefined();
  });
});

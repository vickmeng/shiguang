/**
 * summarizer.test.ts — analyzeCapture 编排单测（vi.mock 打桩 Agent）。
 *
 * vi.mock('@mastra/core/agent') 打桩 Agent：generateMock 捕获 agent.generate
 * 收到的 messages 与 options；agentConfigs 捕获 Agent 构造入参。
 * 图片读盘走真实临时目录（mkdtemp 注入 setAnalysisImagesBaseDir）。
 * 模块经 vi.resetModules() 逐用例重载，保证 imagesBaseDir 模块级状态相互隔离。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

type SummarizerModule = typeof import('./summarizer');

const MISSING_KEY_MESSAGE =
  '未配置 KIMI_API_KEY：请在仓库根 .env 中配置后重启应用（参考 .env.example)';
const MISSING_BASEDIR_MESSAGE =
  'analysis images base dir not initialized: call setAnalysisImagesBaseDir first';

describe('analyzeCapture', () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    generateMock.mockReset();
    agentConfigs.length = 0;
    process.env.KIMI_API_KEY = 'test-kimi-key';
  });

  afterEach(() => {
    delete process.env.KIMI_API_KEY;
    delete process.env.KIMI_MODEL;
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'shiguang-summarizer-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  async function loadSummarizer(): Promise<SummarizerModule> {
    return import('./summarizer');
  }

  it('未配置 KIMI_API_KEY 时抛配置指引错误（不发起分析）', async () => {
    delete process.env.KIMI_API_KEY;
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());

    await expect(analyzeCapture({ text: '你好', images: [] })).rejects.toThrow(
      MISSING_KEY_MESSAGE,
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('未注入 images baseDir 时抛初始化指引错误', async () => {
    const { analyzeCapture } = await loadSummarizer();

    await expect(analyzeCapture({ text: '你好', images: [] })).rejects.toThrow(
      MISSING_BASEDIR_MESSAGE,
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('解析成功路径返回 { meaningful: true, summary }，system prompt 与 text part 正确入列', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir, SUMMARIZER_SYSTEM_PROMPT } =
      await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: true, summary: '一句话摘要' } });

    const result = await analyzeCapture({ text: '今天记录了架构设计', images: [] });

    expect(result).toEqual({ meaningful: true, summary: '一句话摘要' });
    const [messages] = generateMock.mock.calls[0] as Array<
      Array<{ role: string; content: unknown }>
    >;
    expect(messages[0]).toEqual({ role: 'system', content: SUMMARIZER_SYSTEM_PROMPT });
    const userParts = messages[1].content as Array<{ type: string; text?: string }>;
    expect(userParts).toContainEqual({ type: 'text', text: '今天记录了架构设计' });
  });

  it('tags 非空时 user content 在文字块之后追加标签文本块（顿号连接）', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });

    await analyzeCapture({ text: '今天记录了架构设计', images: [], tags: ['重点', '工作'] });

    const [messages] = generateMock.mock.calls[0] as Array<
      Array<{ role: string; content: unknown }>
    >;
    const userParts = messages[1].content as Array<{ type: string; text?: string }>;
    expect(userParts).toEqual([
      { type: 'text', text: '今天记录了架构设计' },
      { type: 'text', text: '用户为这条记录打的标签：重点、工作' },
    ]);
  });

  it('不传 tags 或传空数组时不追加标签文本块', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValue({ object: { meaningful: false } });

    await analyzeCapture({ text: '无标签记录', images: [] });
    await analyzeCapture({ text: '空标签记录', images: [], tags: [] });

    for (const call of generateMock.mock.calls) {
      const [messages] = call as Array<Array<{ role: string; content: unknown }>>;
      const userParts = messages[1].content as Array<{ type: string; text?: string }>;
      expect(userParts.some((p) => p.text?.startsWith('用户为这条记录打的标签'))).toBe(false);
    }
  });

  it('meaningful=false 时返回 { meaningful: false }（不带 summary）', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });

    const result = await analyzeCapture({ text: 'asdfqwer 乱敲', images: [] });

    expect(result).toEqual({ meaningful: false });
  });

  it('generate options 携带 AbortSignal.timeout(60_000) 形态的 abortSignal', async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });

    await analyzeCapture({ text: 'x', images: [] });

    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    const options = generateMock.mock.calls[0][1] as { abortSignal: AbortSignal };
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
  });

  it('图片读盘转 data:image/png;base64 data URL；text 为空串时不带 text part（纯图路径）', async () => {
    const dir = makeTempDir();
    const png = Buffer.from('fake-png-content');
    writeFileSync(join(dir, 'images-abc.png'), png);
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(dir);
    generateMock.mockResolvedValueOnce({ object: { meaningful: true, summary: '截图摘要' } });

    const result = await analyzeCapture({ text: '', images: [{ filePath: 'images-abc.png' }] });

    expect(result).toEqual({ meaningful: true, summary: '截图摘要' });
    const [messages] = generateMock.mock.calls[0] as Array<
      Array<{ role: string; content: unknown }>
    >;
    const userParts = messages[1].content as Array<{ type: string; image?: string }>;
    expect(userParts.some((p) => p.type === 'text')).toBe(false);
    const imagePart = userParts.find((p) => p.type === 'image');
    expect(imagePart?.image).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('读盘失败原样抛错（不吞文件系统错误）', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());

    await expect(
      analyzeCapture({ text: '', images: [{ filePath: 'not-exist.png' }] }),
    ).rejects.toThrow(/ENOENT/);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('meaningful=true 但 summary 纯空白时抛「AI 返回空摘要」', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: true, summary: '  ' } });

    await expect(analyzeCapture({ text: 'x', images: [] })).rejects.toThrow('AI 返回空摘要');
  });

  it('AI 返回 grade 时 analyzeCapture 解析为 { meaningful: true, summary, grade }', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({
      object: { meaningful: true, summary: 'x', grade: 'high' },
    });

    const result = await analyzeCapture({ text: '观点类记录', images: [] });

    expect(result).toEqual({ meaningful: true, summary: 'x', grade: 'high' });
  });

  it('AI 未返回 grade 时解析通过且返回对象无 grade 键（缺失存 NULL）', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: true, summary: 'x' } });

    const result = await analyzeCapture({ text: '日常记录', images: [] });

    expect(result).toEqual({ meaningful: true, summary: 'x' });
    expect('grade' in result).toBe(false);
  });

  it('meaningful=false 分支返回无 grade 键', async () => {
    const { analyzeCapture, setAnalysisImagesBaseDir } = await loadSummarizer();
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });

    const result = await analyzeCapture({ text: '乱敲', images: [] });

    expect(result).toEqual({ meaningful: false });
    expect('grade' in result).toBe(false);
  });
});

describe('SUMMARIZER_SYSTEM_PROMPT 与 Agent 构造（design 3.2 草案逐字锁定）', () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    generateMock.mockReset();
    agentConfigs.length = 0;
    process.env.KIMI_API_KEY = 'test-kimi-key';
  });

  afterEach(() => {
    delete process.env.KIMI_API_KEY;
    delete process.env.KIMI_MODEL;
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'shiguang-summarizer-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('Agent 构造入参 name/instructions 与 SUMMARIZER_SYSTEM_PROMPT 一致', async () => {
    const { SUMMARIZER_SYSTEM_PROMPT, setAnalysisImagesBaseDir } = await import('./summarizer');
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });
    const { analyzeCapture } = await import('./summarizer');

    await analyzeCapture({ text: 'x', images: [] });

    expect(agentConfigs).toHaveLength(1);
    const config = agentConfigs[0];
    expect(config.name).toBe('capture-summarizer');
    expect(config.instructions).toBe(SUMMARIZER_SYSTEM_PROMPT);
  });

  it('Agent model 为 Mastra 原生 custom endpoint 配置（id/url/apiKey，generate 时惰性求值）', async () => {
    process.env.KIMI_API_KEY = 'test-kimi-key';
    const { setAnalysisImagesBaseDir } = await import('./summarizer');
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });
    const { analyzeCapture } = await import('./summarizer');

    await analyzeCapture({ text: 'x', images: [] });

    expect(agentConfigs).toHaveLength(1);
    const model = agentConfigs[0].model as () => Record<string, unknown>;
    expect(model()).toEqual({
      id: 'custom/kimi-k2.6',
      url: 'https://api.kimi.com/coding/v1',
      apiKey: 'test-kimi-key',
    });

    // KIMI_MODEL 覆盖在 model 函数求值时生效（与 resolveKimiModel 语义一致）
    process.env.KIMI_MODEL = 'kimi-custom-model';
    expect((model() as { id: string }).id).toBe('custom/kimi-custom-model');
  });

  it('SUMMARIZER_SYSTEM_PROMPT 含门卫/摘要关键条款（手误、纯符号、60 字、图片是内容的一部分）', async () => {
    const { SUMMARIZER_SYSTEM_PROMPT } = await import('./summarizer');

    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('手误');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('纯符号');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('60 字');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('图片是内容的一部分，不是附件');
  });

  it('SUMMARIZER_SYSTEM_PROMPT 输入构成行含标签线索说明', async () => {
    const { SUMMARIZER_SYSTEM_PROMPT } = await import('./summarizer');

    expect(SUMMARIZER_SYSTEM_PROMPT).toContain(
      '用户为这条记录打的标签（可能没有，标签是用户亲自标记的线索）',
    );
  });

  it('SUMMARIZER_SYSTEM_PROMPT 分级任务条款：标签语义表强调必为 high、从严给 high、宁缺毋滥', async () => {
    const { SUMMARIZER_SYSTEM_PROMPT } = await import('./summarizer');

    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('对未来了解用户的价值');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('该条必为 high');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('宁缺毋滥');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('标签不单独构成升级理由');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('仅当 meaningful=true 时输出分级');
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain(
      '严格输出 JSON：{"meaningful": true/false, "summary": "...", "grade": "high"|"mid"|"low"}（不值得保存时省略 summary 与 grade）',
    );
  });

  it('structuredOutput schema（zod）：meaningful=true 可无 summary；summary 非字符串拒绝', async () => {
    const { setAnalysisImagesBaseDir } = await import('./summarizer');
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });
    const { analyzeCapture } = await import('./summarizer');

    await analyzeCapture({ text: 'x', images: [] });

    const options = generateMock.mock.calls[0][1] as {
      structuredOutput: { schema: { safeParse: (v: unknown) => { success: boolean } } };
    };
    expect(options.structuredOutput.schema.safeParse({ meaningful: true }).success).toBe(true);
    expect(
      options.structuredOutput.schema.safeParse({ meaningful: true, summary: '一句话' }).success,
    ).toBe(true);
    expect(
      options.structuredOutput.schema.safeParse({ meaningful: true, summary: 123 }).success,
    ).toBe(false);
    expect(options.structuredOutput.schema.safeParse({ summary: '缺 meaningful' }).success).toBe(
      false,
    );
  });

  it('grade 非法枚举值（如「高」）由 schema 拒绝；合法三档与缺失均通过', async () => {
    const { setAnalysisImagesBaseDir } = await import('./summarizer');
    setAnalysisImagesBaseDir(makeTempDir());
    generateMock.mockResolvedValueOnce({ object: { meaningful: false } });
    const { analyzeCapture } = await import('./summarizer');

    await analyzeCapture({ text: 'x', images: [] });

    const options = generateMock.mock.calls[0][1] as {
      structuredOutput: { schema: { safeParse: (v: unknown) => { success: boolean } } };
    };
    const { safeParse } = options.structuredOutput.schema;
    expect(safeParse({ meaningful: true, summary: 'x', grade: '高' }).success).toBe(false);
    expect(safeParse({ meaningful: true, summary: 'x', grade: 'high' }).success).toBe(true);
    expect(safeParse({ meaningful: true, summary: 'x', grade: 'mid' }).success).toBe(true);
    expect(safeParse({ meaningful: true, summary: 'x', grade: 'low' }).success).toBe(true);
    expect(safeParse({ meaningful: true, summary: 'x' }).success).toBe(true);
  });
});

describe('resolveKimiModel', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.KIMI_MODEL;
  });

  afterEach(() => {
    delete process.env.KIMI_MODEL;
  });

  it('缺省返回 kimi-k2.6', async () => {
    const { resolveKimiModel, DEFAULT_KIMI_MODEL } = await import('./summarizer');

    expect(DEFAULT_KIMI_MODEL).toBe('kimi-k2.6');
    expect(resolveKimiModel()).toBe('kimi-k2.6');
  });

  it('KIMI_MODEL 环境变量覆盖时返回覆盖值', async () => {
    process.env.KIMI_MODEL = 'kimi-custom-model';
    const { resolveKimiModel } = await import('./summarizer');

    expect(resolveKimiModel()).toBe('kimi-custom-model');
  });
});

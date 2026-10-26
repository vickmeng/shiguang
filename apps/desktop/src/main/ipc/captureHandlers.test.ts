/**
 * captureHandlers 单测：验证 `capture:create`（AC-1/AC-6，写盘与入库编排）
 * 与 `capture:copy-image`（AC-9，ai-record-summary 任务 8 起按 id 经 getById
 * 精确查记录并复制记录首图到剪贴板，不再扫全表 queryCaptures.find；
 * M4 起记录支持多图，恒复制 imagePaths[0]）。
 *
 * capture:create：payload.images 为 { data, sizeBytes }[]，handler 先
 * map 提取 data 调 writeImageFiles（图片写盘服务，失败时已写文件回滚
 * 由 screenshotService.test.ts 覆盖），返回的 written 原样进
 * createCaptureWithAttachments 的 attachments（sizeBytes 以 written 为准入库），
 * sourceApp 恒 null；payload.document（Lexical EditorState JSON，可空）原样
 * 转发进 createCaptureWithAttachments 的 document，缺省归一为 null
 * （design.md 决策 16：双写入 records.document 列）；
 * writeImageFiles 抛错时 createCaptureWithAttachments
 * 零调用且 invoke 拒绝。
 *
 * AI 分析编排（ai-record-summary，AC-1/AC-2/AC-3）：writeImageFiles 落盘成功后
 * 进入 try 块依次 analyzeCapture（@shiguang/ai，Kimi 多模态门卫+摘要）→
 * 有意义判定（!analysis.meaningful 或 summary 空白）时抛
 * AI_NOT_MEANINGFUL_MESSAGE → createCaptureWithAttachments 携
 * analysis: { summary, model: resolveKimiModel() } 入库；try 块内任一步抛错
 * 均逐个 fs.rm(force) 清理已写图片后原样 rethrow，DAO 零调用。
 *
 * mock electron 的 ipcMain/nativeImage/clipboard/app 与 @shiguang/ai 的
 * getById（DAO 真行为由 captureDao.test.ts 覆盖；queryCaptures 仍由
 * captureList 消费，断言 copy-image 零调用），断言：
 *  - 含图记录：nativeImage.createFromPath(userData/imagePaths[0]) → 非空 →
 *    clipboard.write（W3C ClipboardItem，image/png Blob）；
 *  - 多图记录：复制 imagePaths[0] 对应文件；
 *  - 无图记录（imagePaths: []）：抛 Error('该记录不是图片')，invoke 被拒绝；
 *  - 不存在的 id：invoke 被拒绝（该记录不是图片）；
 *  - 缺失/损坏文件（image.isEmpty()）：抛 Error('图片文件缺失或损坏')，invoke 被拒绝。
 */
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AI_NOT_MEANINGFUL_MESSAGE, IPC } from '@shiguang/shared';
import type { CaptureRecord, CreateCapturePayload } from '@shiguang/shared';

const USER_DATA = '/tmp/shiguang-userdata';

const { stubs, image } = vi.hoisted(() => {
  const image = { isEmpty: vi.fn(() => false), toPNG: vi.fn(() => Buffer.from('png')) };
  return {
    image,
    stubs: {
      fs: {
        // promises.rm 返回 Promise（handler 内 await 后 .catch 吞错）
        promises: { rm: vi.fn(() => Promise.resolve()) },
        rmSync: vi.fn(),
      },
      ipcMain: {
        removeAllListeners: vi.fn(),
        on: vi.fn(),
        handle: vi.fn(),
      },
      nativeImage: { createFromPath: vi.fn(() => image) },
      clipboard: { write: vi.fn() },
      // Electron 44 起 clipboard 换成 W3C 异步 API，ClipboardItem 由 mock 提供
      ClipboardItem: class {
        readonly types: string[];
        constructor(items: Record<string, unknown>) {
          this.types = Object.keys(items);
        }
      },
      app: { getPath: vi.fn(() => USER_DATA) },
      queryCaptures: vi.fn(),
      getById: vi.fn(),
      createCaptureWithAttachments: vi.fn(),
      analyzeCapture: vi.fn(),
      resolveKimiModel: vi.fn(),
    },
  };
});

vi.mock('node:fs', () => ({
  default: stubs.fs,
  rmSync: stubs.fs.rmSync,
}));

vi.mock('electron', () => ({
  ipcMain: stubs.ipcMain,
  nativeImage: stubs.nativeImage,
  clipboard: stubs.clipboard,
  ClipboardItem: stubs.ClipboardItem,
  app: stubs.app,
}));
vi.mock('@shiguang/ai', () => ({
  createCaptureWithAttachments: stubs.createCaptureWithAttachments,
  queryCaptures: stubs.queryCaptures,
  getById: stubs.getById,
  deleteCaptures: vi.fn(() => []),
  analyzeCapture: stubs.analyzeCapture,
  resolveKimiModel: stubs.resolveKimiModel,
}));

vi.mock('../screenshot/screenshotService', () => ({
  writeImageFiles: vi.fn(),
}));

import { writeImageFiles } from '../screenshot/screenshotService';
import { registerCaptureHandlers } from './captureHandlers';

function record(partial: Partial<CaptureRecord>): CaptureRecord {
  return {
    id: 1,
    text: '',
    document: null,
    sourceApp: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    imagePaths: [],
    tags: [],
    ...partial,
  };
}

/** 取出 capture:create 的 invoke handler 并以其返回值/拒绝做断言。 */
async function invokeCreate(payload: CreateCapturePayload): Promise<unknown> {
  registerCaptureHandlers();
  const call = stubs.ipcMain.handle.mock.calls.find((c) => c[0] === IPC.captureCreate)!;
  const handler = call[1] as (
    event: unknown,
    payload: CreateCapturePayload,
  ) => Promise<unknown>;
  return handler({}, payload);
}

describe('capture:create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // AI 分析默认成功（既有用例聚焦写盘/入库编排，DAO 入参 analysis 另行断言）
    stubs.analyzeCapture.mockResolvedValue({ meaningful: true, summary: '默认摘要' });
    stubs.resolveKimiModel.mockReturnValue('kimi-k2.6');
  });

  it('携 2 图：writeImageFiles 先调用（提取 data 字节），written 原样进 createCaptureWithAttachments', async () => {
    const dataA = new Uint8Array([1, 2, 3]);
    const dataB = new Uint8Array([4, 5]);
    const written = [
      { filePath: 'images/a.png', sizeBytes: 3 },
      { filePath: 'images/b.png', sizeBytes: 2 },
    ];
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    const tags = ['工作', '灵感'];
    const payload: CreateCapturePayload = {
      text: '图文混排',
      document: null,
      images: [
        { data: dataA, sizeBytes: 3 },
        { data: dataB, sizeBytes: 2 },
      ],
      tags,
    };

    await invokeCreate(payload);

    expect(writeImageFiles).toHaveBeenCalledTimes(1);
    expect(writeImageFiles).toHaveBeenCalledWith([dataA, dataB]);
    expect(stubs.createCaptureWithAttachments).toHaveBeenCalledTimes(1);
    expect(stubs.createCaptureWithAttachments).toHaveBeenCalledWith({
      text: '图文混排',
      document: null,
      sourceApp: null,
      attachments: written,
      tags,
      analysis: { summary: '默认摘要', model: 'kimi-k2.6' },
    });
    expect(vi.mocked(writeImageFiles).mock.invocationCallOrder[0]).toBeLessThan(
      stubs.createCaptureWithAttachments.mock.invocationCallOrder[0],
    );
  });

  it('document 含 2 个 blob: image 节点：按序重写为 written 相对路径，段落文本不变', async () => {
    const written = [
      { filePath: 'images/a.png', sizeBytes: 3 },
      { filePath: 'images/b.png', sizeBytes: 2 },
    ];
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    const document = JSON.stringify({
      root: {
        children: [
          { type: 'image', src: 'blob:mock-1', altText: '图一' },
          { type: 'paragraph', children: [{ type: 'text', text: '中间段落' }] },
          { type: 'image', src: 'blob:mock-2', altText: '图二' },
        ],
      },
    });
    const payload: CreateCapturePayload = {
      text: '图文混排',
      document,
      images: [
        { data: new Uint8Array([1]), sizeBytes: 3 },
        { data: new Uint8Array([2]), sizeBytes: 2 },
      ],
    };

    await invokeCreate(payload);

    const arg = stubs.createCaptureWithAttachments.mock.calls[0][0] as {
      document: string;
    };
    const parsed = JSON.parse(arg.document);
    expect(parsed.root.children[0].src).toBe('images/a.png');
    expect(parsed.root.children[2].src).toBe('images/b.png');
    expect(parsed.root.children[1].children[0].text).toBe('中间段落');
  });

  it('document 中 image 节点数超出 written 长度：超出部分保持原值', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue([{ filePath: 'images/a.png', sizeBytes: 1 }]);
    const document = JSON.stringify({
      root: {
        children: [
          { type: 'image', src: 'blob:mock-1' },
          { type: 'image', src: 'blob:mock-2' },
        ],
      },
    });
    const payload: CreateCapturePayload = {
      text: 'x',
      document,
      images: [{ data: new Uint8Array([1]), sizeBytes: 1 }],
    };

    await invokeCreate(payload);

    const arg = stubs.createCaptureWithAttachments.mock.calls[0][0] as {
      document: string;
    };
    const parsed = JSON.parse(arg.document);
    expect(parsed.root.children[0].src).toBe('images/a.png');
    expect(parsed.root.children[1].src).toBe('blob:mock-2');
  });

  it('payload 带 document 字符串：原样转发进 createCaptureWithAttachments 的 document', async () => {
    const document = '{"root":{"children":[{"type":"paragraph","children":[]}]}}';
    vi.mocked(writeImageFiles).mockResolvedValue([]);
    const payload: CreateCapturePayload = {
      text: '富文本记录',
      document,
      images: [],
    };

    await invokeCreate(payload);

    expect(stubs.createCaptureWithAttachments).toHaveBeenCalledWith({
      text: '富文本记录',
      document,
      sourceApp: null,
      attachments: [],
      analysis: { summary: '默认摘要', model: 'kimi-k2.6' },
    });
  });

  it('payload 不带 document 字段：document 归一为 null', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue([]);
    const payload: CreateCapturePayload = { text: '纯文字', images: [] };

    await invokeCreate(payload);

    expect(stubs.createCaptureWithAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ document: null }),
    );
  });

  it('payload 不带 tags 字段：tags 以 undefined 透传（DAO 侧归一入库 [])', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue([]);
    const payload: CreateCapturePayload = { text: '纯文字', images: [] };

    await invokeCreate(payload);

    expect(stubs.createCaptureWithAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ tags: undefined }),
    );
  });

  it('writeImageFiles 抛错：createCaptureWithAttachments 零调用且 invoke 拒绝', async () => {
    const err = new Error('磁盘写入失败');
    vi.mocked(writeImageFiles).mockRejectedValue(err);
    const payload: CreateCapturePayload = {
      text: 'x',
      document: null,
      images: [{ data: new Uint8Array([9]), sizeBytes: 1 }],
    };

    await expect(invokeCreate(payload)).rejects.toThrow('磁盘写入失败');
    expect(stubs.createCaptureWithAttachments).not.toHaveBeenCalled();
  });
});

describe('capture:create AI 分析编排', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.resolveKimiModel.mockReturnValue('kimi-k2.6');
  });

  const written = [
    { filePath: 'images/a.png', sizeBytes: 3 },
    { filePath: 'images/b.png', sizeBytes: 2 },
  ];
  const payload: CreateCapturePayload = {
    text: '图文混排',
    document: null,
    images: [
      { data: new Uint8Array([1]), sizeBytes: 3 },
      { data: new Uint8Array([2]), sizeBytes: 2 },
    ],
  };

  it('成功路径：writeImageFiles → analyzeCapture → createCaptureWithAttachments 按序调用，DAO 入参携带 analysis: { summary, model }，不触发图片清理', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    stubs.analyzeCapture.mockResolvedValue({ meaningful: true, summary: '一句话摘要' });
    stubs.createCaptureWithAttachments.mockResolvedValue(record({ id: 10 }));

    await invokeCreate(payload);

    expect(stubs.analyzeCapture).toHaveBeenCalledWith({
      text: '图文混排',
      images: [{ filePath: 'images/a.png' }, { filePath: 'images/b.png' }],
    });
    expect(stubs.createCaptureWithAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: { summary: '一句话摘要', model: 'kimi-k2.6' },
      }),
    );
    const orderWrite = vi.mocked(writeImageFiles).mock.invocationCallOrder[0];
    const orderAnalyze = stubs.analyzeCapture.mock.invocationCallOrder[0];
    const orderDao = stubs.createCaptureWithAttachments.mock.invocationCallOrder[0];
    expect(orderWrite).toBeLessThan(orderAnalyze);
    expect(orderAnalyze).toBeLessThan(orderDao);
    // 成功路径不触发清理
    expect(stubs.fs.promises.rm).not.toHaveBeenCalled();
  });

  it('meaningful=false：invoke 以 AI_NOT_MEANINGFUL_MESSAGE 拒绝，已写图片逐个 fs.rm 清理，DAO 零调用', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    stubs.analyzeCapture.mockResolvedValue({ meaningful: false });

    await expect(invokeCreate(payload)).rejects.toThrow(AI_NOT_MEANINGFUL_MESSAGE);
    await expect(Promise.reject(new Error(AI_NOT_MEANINGFUL_MESSAGE))).rejects.toThrow(
      '内容未拾光',
    );

    expect(stubs.createCaptureWithAttachments).not.toHaveBeenCalled();
    expect(stubs.fs.promises.rm).toHaveBeenCalledTimes(2);
    expect(stubs.fs.promises.rm).toHaveBeenCalledWith(path.join(USER_DATA, 'images/a.png'), {
      force: true,
    });
    expect(stubs.fs.promises.rm).toHaveBeenCalledWith(path.join(USER_DATA, 'images/b.png'), {
      force: true,
    });
  });

  it('meaningful=true 但 summary 为空白：同样按无意义拒绝并清理', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    stubs.analyzeCapture.mockResolvedValue({ meaningful: true, summary: '   ' });

    await expect(invokeCreate(payload)).rejects.toThrow(AI_NOT_MEANINGFUL_MESSAGE);
    expect(stubs.createCaptureWithAttachments).not.toHaveBeenCalled();
    expect(stubs.fs.promises.rm).toHaveBeenCalledTimes(2);
  });

  it('analyzeCapture 抛错（模拟断网/超时）：清理图片后原样 reject，DAO 零调用', async () => {
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    stubs.analyzeCapture.mockRejectedValue(new Error('网络超时'));

    await expect(invokeCreate(payload)).rejects.toThrow('网络超时');

    expect(stubs.createCaptureWithAttachments).not.toHaveBeenCalled();
    expect(stubs.fs.promises.rm).toHaveBeenCalledTimes(2);
    expect(stubs.fs.promises.rm).toHaveBeenCalledWith(path.join(USER_DATA, 'images/a.png'), {
      force: true,
    });
  });
});

/** 取出 capture:copy-image 的 invoke handler 并以其返回值/拒绝做断言。 */
async function invokeCopyImage(id: number): Promise<unknown> {
  registerCaptureHandlers();
  const call = stubs.ipcMain.handle.mock.calls.find((c) => c[0] === IPC.captureCopyImage)!;
  const handler = call[1] as (event: unknown, payload: { id: number }) => Promise<void>;
  return handler({}, { id });
}

describe('capture:copy-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    image.isEmpty.mockReturnValue(false);
  });

  it('含图记录：getById(id) 命中 → createFromPath(userData/imagePaths[0]) 且 clipboard.write，零调用 queryCaptures', async () => {
    stubs.getById.mockReturnValue(record({ id: 7, imagePaths: ['images/a.png'] }));

    await invokeCopyImage(7);

    expect(stubs.getById).toHaveBeenCalledWith(7);
    expect(stubs.queryCaptures).not.toHaveBeenCalled();
    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(USER_DATA, 'images', 'a.png'),
    );
    expect(image.isEmpty).toHaveBeenCalledTimes(1);
    expect(image.toPNG).toHaveBeenCalledTimes(1);
    expect(stubs.clipboard.write).toHaveBeenCalledTimes(1);
  });

  it('多图记录：复制 imagePaths[0] 对应文件，零调用 queryCaptures', async () => {
    stubs.getById.mockReturnValue(
      record({ id: 8, imagePaths: ['images/first.png', 'images/second.png'] }),
    );

    await invokeCopyImage(8);

    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledTimes(1);
    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(USER_DATA, 'images', 'first.png'),
    );
    expect(stubs.clipboard.write).toHaveBeenCalledTimes(1);
    expect(stubs.queryCaptures).not.toHaveBeenCalled();
  });

  it('无图记录（imagePaths: []）：invoke 被 Error("该记录不是图片") 拒绝', async () => {
    stubs.getById.mockReturnValue(record({ id: 3, text: 'hello' }));

    await expect(invokeCopyImage(3)).rejects.toThrow('该记录不是图片');
    expect(stubs.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(stubs.clipboard.write).not.toHaveBeenCalled();
  });

  it('不存在的记录 id（getById 返回 null）：invoke 被拒绝（该记录不是图片）', async () => {
    stubs.getById.mockReturnValue(null);

    await expect(invokeCopyImage(999)).rejects.toThrow('该记录不是图片');
    expect(stubs.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(stubs.clipboard.write).not.toHaveBeenCalled();
  });

  it('图片文件缺失或损坏（isEmpty()）：invoke 被 Error("图片文件缺失或损坏") 拒绝', async () => {
    stubs.getById.mockReturnValue(record({ id: 9, imagePaths: ['images/gone.png'] }));
    image.isEmpty.mockReturnValue(true);

    await expect(invokeCopyImage(9)).rejects.toThrow('图片文件缺失或损坏');
    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(USER_DATA, 'images', 'gone.png'),
    );
    expect(stubs.clipboard.write).not.toHaveBeenCalled();
  });
});

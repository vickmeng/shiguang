/**
 * captureHandlers 单测：验证 `capture:create`（AC-1/AC-6，写盘与入库编排）
 * 与 `capture:copy-image`（AC-9，按 id 查记录并复制记录首图到剪贴板，
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
 * mock electron 的 ipcMain/nativeImage/clipboard/app 与 @shiguang/ai 的
 * queryCaptures（DAO 真行为由 captureDao.test.ts 覆盖），断言：
 *  - 含图记录：nativeImage.createFromPath(userData/imagePaths[0]) → 非空 →
 *    clipboard.write（W3C ClipboardItem，image/png Blob）；
 *  - 多图记录：复制 imagePaths[0] 对应文件；
 *  - 无图记录（imagePaths: []）：抛 Error('该记录不是图片')，invoke 被拒绝；
 *  - 不存在的 id：invoke 被拒绝（该记录不是图片）；
 *  - 缺失/损坏文件（image.isEmpty()）：抛 Error('图片文件缺失或损坏')，invoke 被拒绝。
 */
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IPC } from '@shiguang/shared';
import type { CaptureRecord, CreateCapturePayload } from '@shiguang/shared';

const USER_DATA = '/tmp/shiguang-userdata';

const { stubs, image } = vi.hoisted(() => {
  const image = { isEmpty: vi.fn(() => false), toPNG: vi.fn(() => Buffer.from('png')) };
  return {
    image,
    stubs: {
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
      createCaptureWithAttachments: vi.fn(),
    },
  };
});

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
  deleteCaptures: vi.fn(() => []),
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
    sourceApp: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    imagePaths: [],
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
  });

  it('携 2 图：writeImageFiles 先调用（提取 data 字节），written 原样进 createCaptureWithAttachments', async () => {
    const dataA = new Uint8Array([1, 2, 3]);
    const dataB = new Uint8Array([4, 5]);
    const written = [
      { filePath: 'images/a.png', sizeBytes: 3 },
      { filePath: 'images/b.png', sizeBytes: 2 },
    ];
    vi.mocked(writeImageFiles).mockResolvedValue(written);
    const payload: CreateCapturePayload = {
      text: '图文混排',
      document: null,
      images: [
        { data: dataA, sizeBytes: 3 },
        { data: dataB, sizeBytes: 2 },
      ],
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
    });
    expect(vi.mocked(writeImageFiles).mock.invocationCallOrder[0]).toBeLessThan(
      stubs.createCaptureWithAttachments.mock.invocationCallOrder[0],
    );
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

  it('含图记录：createFromPath(userData/imagePaths[0]) 且 clipboard.write', async () => {
    stubs.queryCaptures.mockReturnValue({
      items: [record({ id: 7, imagePaths: ['images/a.png'] })],
      total: 1,
    });

    await invokeCopyImage(7);

    expect(stubs.queryCaptures).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    );
    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(USER_DATA, 'images', 'a.png'),
    );
    expect(image.isEmpty).toHaveBeenCalledTimes(1);
    expect(image.toPNG).toHaveBeenCalledTimes(1);
    expect(stubs.clipboard.write).toHaveBeenCalledTimes(1);
  });

  it('多图记录：复制 imagePaths[0] 对应文件', async () => {
    stubs.queryCaptures.mockReturnValue({
      items: [record({ id: 8, imagePaths: ['images/first.png', 'images/second.png'] })],
      total: 1,
    });

    await invokeCopyImage(8);

    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledTimes(1);
    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(USER_DATA, 'images', 'first.png'),
    );
    expect(stubs.clipboard.write).toHaveBeenCalledTimes(1);
  });

  it('无图记录（imagePaths: []）：invoke 被 Error("该记录不是图片") 拒绝', async () => {
    stubs.queryCaptures.mockReturnValue({
      items: [record({ id: 3, text: 'hello' })],
      total: 1,
    });

    await expect(invokeCopyImage(3)).rejects.toThrow('该记录不是图片');
    expect(stubs.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(stubs.clipboard.write).not.toHaveBeenCalled();
  });

  it('不存在的记录 id：invoke 被拒绝（该记录不是图片）', async () => {
    stubs.queryCaptures.mockReturnValue({ items: [], total: 0 });

    await expect(invokeCopyImage(999)).rejects.toThrow('该记录不是图片');
    expect(stubs.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(stubs.clipboard.write).not.toHaveBeenCalled();
  });

  it('图片文件缺失或损坏（isEmpty()）：invoke 被 Error("图片文件缺失或损坏") 拒绝', async () => {
    stubs.queryCaptures.mockReturnValue({
      items: [record({ id: 9, imagePaths: ['images/gone.png'] })],
      total: 1,
    });
    image.isEmpty.mockReturnValue(true);

    await expect(invokeCopyImage(9)).rejects.toThrow('图片文件缺失或损坏');
    expect(stubs.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(USER_DATA, 'images', 'gone.png'),
    );
    expect(stubs.clipboard.write).not.toHaveBeenCalled();
  });
});

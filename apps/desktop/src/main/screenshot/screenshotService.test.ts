/**
 * screenshotService 单测（M4）：图片写盘服务 writeImageFiles。
 *
 * mock node:fs/promises、node:crypto 的 randomUUID、electron 的 app，断言：
 *  - getImagesDir 返回 userData/images 且不做 mkdir；
 *  - writeImageFiles 成功：mkdir（幂等）→ 逐张 randomUUID 命名 writeFile，
 *    返回 N 条 { filePath: 'images/<uuid>.png', sizeBytes: data.length }；
 *  - 第 k 张 writeFile 失败：前 k-1 张逐个 unlink（unlink 失败仅吞掉）、
 *    抛出原始错误、无返回。
 */
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const IMAGES_DIR = path.join('/tmp/shiguang-userdata', 'images');

const { stubs } = vi.hoisted(() => {
  // 每次调用递增，模拟不同 uuid；在 beforeEach 中归零
  const uuidCounter = { seq: 0 };
  return {
    stubs: {
      app: { getPath: vi.fn(() => '/tmp/shiguang-userdata') },
      fsp: {
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        unlink: vi.fn(),
      },
      uuidCounter,
      randomUUID: vi.fn(() => `uuid-${++uuidCounter.seq}`),
    },
  };
});

vi.mock('electron', () => ({ app: stubs.app }));
vi.mock('node:fs/promises', () => stubs.fsp);
vi.mock('node:crypto', () => ({ randomUUID: stubs.randomUUID }));

describe('screenshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.uuidCounter.seq = 0;
    stubs.fsp.mkdir.mockResolvedValue(undefined);
    stubs.fsp.writeFile.mockResolvedValue(undefined);
    stubs.fsp.unlink.mockResolvedValue(undefined);
  });

  it('getImagesDir 返回 userData/images 且不做 mkdir（writeImageFiles 负责）', async () => {
    const { getImagesDir } = await import('./screenshotService');
    const dir = getImagesDir();

    expect(stubs.app.getPath).toHaveBeenCalledWith('userData');
    expect(dir).toBe(IMAGES_DIR);
    expect(stubs.fsp.mkdir).not.toHaveBeenCalled();
  });

  describe('writeImageFiles 图片写盘', () => {
    it('N 张全部成功：mkdir 幂等后逐张命名写盘，返回 N 条相对路径与 sizeBytes', async () => {
      const images = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
      const { writeImageFiles } = await import('./screenshotService');
      const written = await writeImageFiles(images);

      expect(stubs.fsp.mkdir).toHaveBeenCalledTimes(1);
      expect(stubs.fsp.mkdir).toHaveBeenCalledWith(IMAGES_DIR, { recursive: true });
      expect(stubs.fsp.writeFile).toHaveBeenCalledTimes(2);
      expect(stubs.fsp.writeFile).toHaveBeenNthCalledWith(
        1,
        path.join(IMAGES_DIR, 'uuid-1.png'),
        images[0],
      );
      expect(stubs.fsp.writeFile).toHaveBeenNthCalledWith(
        2,
        path.join(IMAGES_DIR, 'uuid-2.png'),
        images[1],
      );
      expect(written).toEqual([
        { filePath: 'images/uuid-1.png', sizeBytes: 3 },
        { filePath: 'images/uuid-2.png', sizeBytes: 2 },
      ]);
      // 成功路径不清理文件
      expect(stubs.fsp.unlink).not.toHaveBeenCalled();
    });

    it('第 k 张失败：前 k-1 张逐个 unlink、抛出原错误、无返回', async () => {
      const images = [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
      ];
      const err = Object.assign(new Error('ENOSPC: no space left on device'), {
        code: 'ENOSPC',
      });
      stubs.fsp.writeFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(err);

      const { writeImageFiles } = await import('./screenshotService');

      await expect(writeImageFiles(images)).rejects.toBe(err);
      expect(stubs.fsp.writeFile).toHaveBeenCalledTimes(2);
      // 仅第 1 张已写盘需清理，失败张自身未写成功无需 unlink
      expect(stubs.fsp.unlink).toHaveBeenCalledTimes(1);
      expect(stubs.fsp.unlink).toHaveBeenCalledWith(path.join(IMAGES_DIR, 'uuid-1.png'));
    });

    it('unlink 失败仅吞掉，不掩盖原始写盘错误', async () => {
      const images = [new Uint8Array([1]), new Uint8Array([2])];
      const writeErr = new Error('write failed');
      stubs.fsp.writeFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(writeErr);
      stubs.fsp.unlink.mockRejectedValueOnce(new Error('unlink failed'));

      const { writeImageFiles } = await import('./screenshotService');

      await expect(writeImageFiles(images)).rejects.toBe(writeErr);
      expect(stubs.fsp.unlink).toHaveBeenCalledTimes(1);
    });

    it('空数组：mkdir 后零写盘，返回空数组', async () => {
      const { writeImageFiles } = await import('./screenshotService');
      const written = await writeImageFiles([]);

      expect(stubs.fsp.mkdir).toHaveBeenCalledWith(IMAGES_DIR, { recursive: true });
      expect(stubs.fsp.writeFile).not.toHaveBeenCalled();
      expect(written).toEqual([]);
    });
  });
});

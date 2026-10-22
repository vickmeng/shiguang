/**
 * tagMemoryStore 单测：验证「标签组合记忆」（REQ-TAG-02 / AC-3）。
 *
 * getLastTags：读取 userData/tags-last.json，文件缺失/损坏/非数组
 * 一律降级 []；setLastTags：先写 tags-last.json.tmp 再 rename 原子替换，
 * 避免半写状态。userData 由 mock electron 的 app.getPath 指向临时目录
 * （照 captureHandlers.test.ts 的 vi.mock 样板）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

const { stubs } = vi.hoisted(() => ({
  stubs: {
    app: { getPath: vi.fn(() => '') },
  },
}));

vi.mock('electron', () => ({
  app: stubs.app,
}));

import { getLastTags, setLastTags } from './tagMemoryStore';

const LAST_TAGS_FILE = 'tags-last.json';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'shiguang-tags-'));
  stubs.app.getPath.mockReturnValue(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('tagMemoryStore', () => {
  it('文件缺失：getLastTags 降级 []', () => {
    expect(getLastTags()).toEqual([]);
  });

  it('写入后读回相等数组', () => {
    setLastTags(['工作', '灵感']);
    expect(getLastTags()).toEqual(['工作', '灵感']);
  });

  it('损坏 JSON（{"a":1}）：降级 []', () => {
    writeFileSync(path.join(dir, LAST_TAGS_FILE), '{"a":1}');
    expect(getLastTags()).toEqual([]);
  });

  it('非数组 JSON（[1,2]）：降级 []', () => {
    writeFileSync(path.join(dir, LAST_TAGS_FILE), '[1,2]');
    expect(getLastTags()).toEqual([]);
  });

  it('两次 setLastTags 后读回第二次值', () => {
    setLastTags(['工作']);
    setLastTags(['生活', '灵感']);
    expect(getLastTags()).toEqual(['生活', '灵感']);
  });

  it('setLastTags 后目标文件为合法 JSON（原子替换后无 tmp 残留）', () => {
    setLastTags(['工作']);
    expect(getLastTags()).toEqual(['工作']);
  });
});

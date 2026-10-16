import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase } from '../db';
import {
  createCapture,
  deleteCapture,
  listCaptures,
  setCaptureDatabase,
} from './captureDao';

function setupDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-capture-dao-test-'));
  const db = initDatabase(join(tmpDir, 'test.db'));
  setCaptureDatabase(db);
  return { tmpDir, db };
}

describe('createCapture', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入一条纯文字记录，sourceApp 缺省为 null，返回数据库生成的 id/createdAt', () => {
    const record = createCapture({ text: 'hello shiguang' });

    expect(record.id).toBeGreaterThan(0);
    expect(record.text).toBe('hello shiguang');
    expect(record.sourceApp).toBeNull();
    expect(record.createdAt).toBeTruthy();
  });

  it('sourceApp 传入时原样保存', () => {
    const record = createCapture({ text: 'hi', sourceApp: 'WeChat' });

    expect(record.sourceApp).toBe('WeChat');
  });
});

describe('listCaptures', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('按 created_at 倒序返回记录', () => {
    createCapture({ text: '最早的一条', sourceApp: null });
    // 同毫秒并发写入时以自增 id 兜底保证顺序，这里直接再写一条即可断言倒序
    createCapture({ text: '最新的一条', sourceApp: null });

    const records = listCaptures();

    expect(records.map((r) => r.text)).toEqual(['最新的一条', '最早的一条']);
    expect(records[0].id).toBeGreaterThan(records[1].id);
  });

  it('limit 截断为最新 N 条；不传 limit 返回全部', () => {
    for (const text of ['a', 'b', 'c']) {
      createCapture({ text });
    }

    const limited = listCaptures(2);
    expect(limited).toHaveLength(2);
    expect(limited[0].text).toBe('c');
    expect(limited[1].text).toBe('b');
    expect(listCaptures()).toHaveLength(3);
  });
});

describe('deleteCapture', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('删除记录后列表不再包含该记录；删除不存在的 id 不抛错', () => {
    const record = createCapture({ text: '待删除' });

    deleteCapture(record.id);

    expect(listCaptures()).toHaveLength(0);
    expect(() => deleteCapture(999)).not.toThrow();
  });
});

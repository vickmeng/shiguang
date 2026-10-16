import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase } from '../db';
import {
  createCapture,
  deleteCaptures,
  listCaptures,
  queryCaptures,
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

describe('queryCaptures', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    const setup = setupDb();
    tmpDir = setup.tmpDir;
    db = setup.db;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 以固定 created_at 直插记录，避免依赖 strftime('now') 的当前时刻。 */
  function insertWithTime(text: string, createdAt: string): void {
    db.prepare(
      `INSERT INTO records (text, source_app, created_at) VALUES (?, NULL, ?)`,
    ).run(text, createdAt);
  }

  function seedRecords() {
    insertWithTime('alpha 早起记录', '2026-01-01T08:00:00.000Z');
    insertWithTime('beta 含关键词目标', '2026-01-05T08:00:00.000Z');
    insertWithTime('gamma 目标 另一条', '2026-01-10T08:00:00.000Z');
  }

  it('按 created_at DESC, id DESC 排序分页返回，total 为全量条数', () => {
    seedRecords();

    const result = queryCaptures({ page: 1, pageSize: 2 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((r) => r.text)).toEqual([
      'gamma 目标 另一条',
      'beta 含关键词目标',
    ]);

    const page2 = queryCaptures({ page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items.map((r) => r.text)).toEqual(['alpha 早起记录']);
  });

  it('keyword 走包含匹配，且 total 只统计匹配项', () => {
    seedRecords();

    const result = queryCaptures({ keyword: '目标', page: 1, pageSize: 10 });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.text)).toEqual([
      'gamma 目标 另一条',
      'beta 含关键词目标',
    ]);
  });

  it('since 走 created_at >= since 过滤', () => {
    seedRecords();

    const result = queryCaptures({
      since: '2026-01-05T00:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.text)).toEqual([
      'gamma 目标 另一条',
      'beta 含关键词目标',
    ]);
  });

  it('keyword 与 since 可组合过滤', () => {
    seedRecords();

    const result = queryCaptures({
      keyword: '目标',
      since: '2026-01-06T00:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.text)).toEqual(['gamma 目标 另一条']);
  });

  it('until 走 created_at <= until 过滤（含该秒）', () => {
    seedRecords();

    const result = queryCaptures({
      until: '2026-01-05T08:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.text)).toEqual([
      'beta 含关键词目标',
      'alpha 早起记录',
    ]);
  });

  it('until 边界：created_at 恰等于 until 的记录被包含', () => {
    insertWithTime('边界记录', '2026-01-05T08:00:00.000Z');
    insertWithTime('边界之后', '2026-01-05T08:00:01.000Z');

    const result = queryCaptures({
      until: '2026-01-05T08:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.items.map((r) => r.text)).toEqual(['边界记录']);
  });

  it('until 与 keyword、since 三条件可组合过滤', () => {
    seedRecords();
    insertWithTime('目标 时间段内', '2026-01-07T08:00:00.000Z');
    insertWithTime('目标 时间段外', '2026-01-12T08:00:00.000Z');

    const result = queryCaptures({
      keyword: '目标',
      since: '2026-01-04T00:00:00.000Z',
      until: '2026-01-10T00:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.text)).toEqual([
      '目标 时间段内',
      'beta 含关键词目标',
    ]);
  });

  it('分页边界：末页不满正常返回，越界页返回空 items 但 total 不变', () => {
    seedRecords();

    const last = queryCaptures({ page: 2, pageSize: 2 });
    expect(last.items).toHaveLength(1);
    expect(last.total).toBe(3);

    const beyond = queryCaptures({ page: 5, pageSize: 2 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(3);
  });
});

describe('deleteCaptures', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('批量删除只删除指定 id，其余记录保留', () => {
    const first = createCapture({ text: '保留' });
    const second = createCapture({ text: '删除 A' });
    const third = createCapture({ text: '删除 B' });

    deleteCaptures([second.id, third.id]);

    expect(listCaptures().map((r) => r.text)).toEqual(['保留']);
    expect(listCaptures()[0].id).toBe(first.id);
  });

  it('传入不存在的 id 不抛错，其余指定 id 仍被删除', () => {
    const record = createCapture({ text: '删除' });
    const keep = createCapture({ text: '保留' });

    deleteCaptures([record.id, 999]);

    expect(listCaptures().map((r) => r.text)).toEqual(['保留']);
    expect(listCaptures()[0].id).toBe(keep.id);
  });

  it('空数组不执行删除、不抛错', () => {
    createCapture({ text: '保留' });

    expect(() => deleteCaptures([])).not.toThrow();
    expect(listCaptures()).toHaveLength(1);
  });
});

describe('deleteCaptures 单元素删除', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('删除记录后列表不再包含该记录；删除不存在的 id 不抛错', () => {
    const record = createCapture({ text: '待删除' });

    deleteCaptures([record.id]);

    expect(listCaptures()).toHaveLength(0);
    expect(() => deleteCaptures([999])).not.toThrow();
  });
});

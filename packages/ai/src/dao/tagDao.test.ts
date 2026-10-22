import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TAG_COLOR_PALETTE, TAG_NAME_MAX_LENGTH } from '@shiguang/shared';
import { initDatabase } from '../db';
import { createTag, deleteTag, listTags, renameTag, setTagDatabase } from './tagDao';

function setupDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-tag-dao-test-'));
  const db = initDatabase(join(tmpDir, 'test.db'));
  setTagDatabase(db);
  return { tmpDir, db };
}

describe('createTag', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    const setup = setupDb();
    tmpDir = setup.tmpDir;
    db = setup.db;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function rowCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS count FROM tags`).get() as { count: number }).count;
  }

  it('新建返回自增 id 与色板内的非空 color', () => {
    const tag = createTag({ name: '工作' });

    expect(tag.id).toBeGreaterThan(0);
    expect(tag.name).toBe('工作');
    expect(TAG_COLOR_PALETTE).toContain(tag.color);

    const row = db.prepare(`SELECT name, color FROM tags WHERE id = ?`).get(tag.id) as {
      name: string;
      color: string;
    };
    expect(row).toEqual({ name: '工作', color: tag.color });
  });

  it('重名 create 返回已有条目，库内仍只有一行（重名转选中语义）', () => {
    const first = createTag({ name: '灵感' });
    const second = createTag({ name: '灵感' });

    expect(second.id).toBe(first.id);
    expect(second.color).toBe(first.color);
    expect(rowCount()).toBe(1);
  });

  it.each(['', '   '])('名称为 %j 时抛「标签名需为 1~20 字」且不产生行', (name) => {
    expect(() => createTag({ name })).toThrow('标签名需为 1~20 字');
    expect(rowCount()).toBe(0);
  });

  it(`名称超过 ${TAG_NAME_MAX_LENGTH} 字时抛「标签名需为 1~20 字」且不产生行`, () => {
    expect(() => createTag({ name: '工'.repeat(TAG_NAME_MAX_LENGTH + 1) })).toThrow(
      '标签名需为 1~20 字',
    );
    expect(rowCount()).toBe(0);
  });

  it('trim 后落库（\' 工作 \' 存 \'工作\'）', () => {
    const tag = createTag({ name: '  工作  ' });

    expect(tag.name).toBe('工作');
    expect(rowCount()).toBe(1);
    // trim 后与库内已有重名同样命中重名转选中语义
    expect(createTag({ name: ' 工作 ' }).id).toBe(tag.id);
    expect(rowCount()).toBe(1);
  });
});

describe('listTags', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    const setup = setupDb();
    tmpDir = setup.tmpDir;
    db = setup.db;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('按 id 升序返回全部标签，行字段 snake→camel 映射', () => {
    const a = createTag({ name: '工作' });
    const b = createTag({ name: '灵感' });

    const tags = listTags();

    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ id: a.id, name: '工作', color: a.color });
    expect(tags[1]).toEqual({ id: b.id, name: '灵感', color: b.color });
    expect(a.id).toBeLessThan(b.id);
  });

  it('空库返回 []', () => {
    expect(listTags()).toEqual([]);
  });
});

describe('renameTag', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    const setup = setupDb();
    tmpDir = setup.tmpDir;
    db = setup.db;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('重命名后 listTags 反映新名且 id/color 不变', () => {
    const tag = createTag({ name: '工作' });

    const renamed = renameTag({ id: tag.id, name: '  学习  ' });

    expect(renamed).toEqual({ id: tag.id, name: '学习', color: tag.color });
    expect(listTags()).toEqual([{ id: tag.id, name: '学习', color: tag.color }]);
  });

  it('重命名不存在的 id 抛「标签不存在」', () => {
    expect(() => renameTag({ id: 999, name: '学习' })).toThrow('标签不存在');
  });

  it.each(['', '   ', '工'.repeat(TAG_NAME_MAX_LENGTH + 1)])(
    '名称为 %j 时抛「标签名需为 1~20 字」且原值不变',
    (name) => {
      const tag = createTag({ name: '工作' });

      expect(() => renameTag({ id: tag.id, name })).toThrow('标签名需为 1~20 字');
      expect(listTags()).toEqual([{ id: tag.id, name: '工作', color: tag.color }]);
    },
  );
});

describe('deleteTag', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    const setup = setupDb();
    tmpDir = setup.tmpDir;
    db = setup.db;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('删除后 listTags 不含该项，再删同 id 静默不抛错', () => {
    const a = createTag({ name: '工作' });
    const b = createTag({ name: '灵感' });

    deleteTag({ id: a.id });
    expect(listTags()).toEqual([{ id: b.id, name: '灵感', color: b.color }]);

    expect(() => deleteTag({ id: a.id })).not.toThrow();
    expect(listTags()).toEqual([{ id: b.id, name: '灵感', color: b.color }]);
  });

  it('删除不回溯 records 表：记录行保持原样', () => {
    const tag = createTag({ name: '工作' });
    db.prepare(`INSERT INTO records (text, source_app) VALUES (?, ?)`).run('一条记录', 'demo');
    const before = db.prepare(`SELECT * FROM records`).all();

    deleteTag({ id: tag.id });

    expect(db.prepare(`SELECT * FROM records`).all()).toEqual(before);
  });
});

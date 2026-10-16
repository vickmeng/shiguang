import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDatabase } from './db';
import { migration } from './migrations/0001_init';

describe('initDatabase', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-db-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('迁移后单表 records 存在（无 attachments 表），且外键约束已开启', () => {
    const db = initDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('records', 'attachments')")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(['records']);

    const recordCols = db
      .prepare('PRAGMA table_info(records)')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(recordCols).toEqual(
      expect.arrayContaining(['id', 'text', 'source_app', 'created_at']),
    );
    expect(recordCols).not.toContain('type');

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toContain('idx_records_created_at');

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    db.close();
  });

  it('二次调用不重复执行迁移（已执行迁移被 SQLite storage 记录）', () => {
    const upSpy = vi.spyOn(migration, 'up');

    const db1 = initDatabase(dbPath);
    db1.close();
    expect(upSpy).toHaveBeenCalledTimes(1);

    // 0001_init 的 DDL 使用裸 CREATE TABLE：若被重复执行必然抛错；
    // 第二次调用整体不抛错且 up 未被再次调用，即证明迁移未重复执行。
    const db2 = initDatabase(dbPath);
    expect(upSpy).toHaveBeenCalledTimes(1);

    const logged = db2
      .prepare('SELECT name FROM _migrations ORDER BY name')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(logged).toEqual(['0001_init']);

    db2.close();
  });
});

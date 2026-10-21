import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDatabase } from './db';
import { migration } from './migrations/0001_init';
import { migration as attachmentMigration } from './migrations/0002_attachment';
import { migration as dropTypeMigration } from './migrations/0003_drop_type';

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

  it('迁移后 records 无 type 列、含可空 document 列，attachments 表存在，且外键约束已开启', () => {
    const db = initDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('records', 'attachments')")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['records', 'attachments']));

    const recordCols = db
      .prepare('PRAGMA table_info(records)')
      .all() as unknown as Array<{ name: string; notnull: number }>;
    const recordColNames = recordCols.map((row) => row.name);
    expect(recordColNames).toEqual(
      expect.arrayContaining(['id', 'text', 'source_app', 'created_at', 'document']),
    );
    expect(recordColNames).not.toContain('type');
    // document 为 Lexical EditorState JSON，可空
    expect(recordCols.find((c) => c.name === 'document')?.notnull).toBe(0);

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
    const attachmentUpSpy = vi.spyOn(attachmentMigration, 'up');
    const dropTypeUpSpy = vi.spyOn(dropTypeMigration, 'up');

    const db1 = initDatabase(dbPath);
    db1.close();
    expect(upSpy).toHaveBeenCalledTimes(1);
    expect(attachmentUpSpy).toHaveBeenCalledTimes(1);
    expect(dropTypeUpSpy).toHaveBeenCalledTimes(1);

    // 迁移 DDL 均使用裸 CREATE TABLE / ADD COLUMN / DROP COLUMN：若被重复执行必然抛错；
    // 第二次调用整体不抛错且 up 未被再次调用，即证明迁移未重复执行。
    const db2 = initDatabase(dbPath);
    expect(upSpy).toHaveBeenCalledTimes(1);
    expect(attachmentUpSpy).toHaveBeenCalledTimes(1);
    expect(dropTypeUpSpy).toHaveBeenCalledTimes(1);

    const logged = db2
      .prepare('SELECT name FROM _migrations ORDER BY name')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(logged).toEqual(['0001_init', '0002_attachment', '0003_drop_type']);

    db2.close();
  });
});

describe('迁移 0003_drop_type', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-migration-0003-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('旧库（仅 0001+0002 结构与数据）升级后 type 列消失、document 列可空新增，attachments 数据不受影响', async () => {
    // 手工构造仅应用 0001+0002 的"旧库"：含 type 列与既有 attachments 数据
    const oldDb = new Database(dbPath);
    oldDb.pragma('foreign_keys = ON');
    await migration.up({ context: oldDb });
    await attachmentMigration.up({ context: oldDb });
    oldDb.prepare(`INSERT INTO records (text, source_app, type) VALUES (?, ?, 'text')`).run('旧文字', null);
    oldDb
      .prepare(`INSERT INTO records (text, source_app, type) VALUES ('', 'screenshot', 'image')`)
      .run();
    const imageRecordId = Number(
      (oldDb.prepare(`SELECT id FROM records WHERE type = 'image'`).get() as { id: number }).id,
    );
    oldDb
      .prepare(`INSERT INTO attachments (record_id, file_path, size_bytes) VALUES (?, ?, ?)`)
      .run(imageRecordId, 'images/legacy.png', 42);
    oldDb.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(migration.name);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(attachmentMigration.name);
    oldDb.close();

    // 再次 initDatabase：应跳过 0001/0002、仅应用 0003
    const db = initDatabase(dbPath);

    const recordCols = db
      .prepare('PRAGMA table_info(records)')
      .all() as unknown as Array<{ name: string; notnull: number }>;
    const recordColNames = recordCols.map((c) => c.name);
    expect(recordColNames).not.toContain('type');
    expect(recordColNames).toContain('document');
    expect(recordColNames).toEqual(
      expect.arrayContaining(['id', 'text', 'source_app', 'created_at', 'document']),
    );
    expect(recordCols.find((c) => c.name === 'document')?.notnull).toBe(0);

    // 旧行数据保留，且可不带 document 写入新行（可空）
    expect(
      (db.prepare(`SELECT COUNT(*) AS count FROM records`).get() as { count: number }).count,
    ).toBe(2);
    db.prepare(`INSERT INTO records (text) VALUES ('新文字')`).run();
    const newRow = db
      .prepare(`SELECT document FROM records WHERE text = '新文字'`)
      .get() as { document: string | null };
    expect(newRow.document).toBeNull();

    // attachments 表结构与数据不受 0003 影响
    const attachmentCols = (
      db.prepare(`PRAGMA table_info(attachments)`).all() as unknown as Array<{ name: string }>
    ).map((c) => c.name);
    expect(attachmentCols).toEqual(
      expect.arrayContaining(['id', 'record_id', 'file_path', 'mime_type', 'size_bytes', 'created_at']),
    );
    const attachmentRow = db
      .prepare(`SELECT record_id, file_path, size_bytes FROM attachments`)
      .get() as { record_id: number; file_path: string; size_bytes: number };
    expect(attachmentRow).toEqual({
      record_id: imageRecordId,
      file_path: 'images/legacy.png',
      size_bytes: 42,
    });

    db.close();
  });

  it('migration.down() 后 document 列消失、type 列恢复并按 attachments 回填', async () => {
    const db = initDatabase(dbPath);

    // 造数：一图（含附件）、一纯文字、一带 document 的纯文字
    db.prepare(`INSERT INTO records (text, document) VALUES (?, ?)`).run('图文记录的说明', null);
    const imageRecordId = Number(
      (db.prepare(`SELECT id FROM records WHERE text = '图文记录的说明'`).get() as { id: number }).id,
    );
    db.prepare(`INSERT INTO attachments (record_id, file_path) VALUES (?, ?)`).run(
      imageRecordId,
      'images/a.png',
    );
    db.prepare(`INSERT INTO records (text) VALUES (?)`).run('纯文字');
    db.prepare(`INSERT INTO records (text, document) VALUES (?, ?)`).run(
      '带版式',
      '{"root":{"children":[]}}',
    );

    await dropTypeMigration.down({ context: db });

    const recordCols = db
      .prepare('PRAGMA table_info(records)')
      .all() as unknown as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const recordColNames = recordCols.map((c) => c.name);
    expect(recordColNames).not.toContain('document');
    expect(recordColNames).toContain('type');
    const typeCol = recordCols.find((c) => c.name === 'type');
    expect(typeCol?.notnull).toBe(1);
    expect(typeCol?.dflt_value).toBe(`'text'`);

    const rows = db
      .prepare(`SELECT text, type FROM records ORDER BY id`)
      .all() as unknown as Array<{ text: string; type: string }>;
    expect(rows).toEqual([
      { text: '图文记录的说明', type: 'image' },
      { text: '纯文字', type: 'text' },
      { text: '带版式', type: 'text' },
    ]);

    // 回填后表可正常按 0002 契约写入（type 列带默认值与 CHECK）
    db.prepare(`INSERT INTO records (text, type) VALUES ('down 后新行', 'image')`).run();

    db.close();
  });
});

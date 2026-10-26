import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDatabase } from './db';
import { migration } from './migrations/0001_init';
import { migration as attachmentMigration } from './migrations/0002_attachment';
import { migration as dropTypeMigration } from './migrations/0003_drop_type';
import { migration as tagsMigration } from './migrations/0004_tags';
import { migration as analysesMigration } from './migrations/0005_analyses';
import { migration as analysesGradeMigration } from './migrations/0006_analyses_grade';

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
    const tagsUpSpy = vi.spyOn(tagsMigration, 'up');

    const db1 = initDatabase(dbPath);
    db1.close();
    expect(upSpy).toHaveBeenCalledTimes(1);
    expect(attachmentUpSpy).toHaveBeenCalledTimes(1);
    expect(dropTypeUpSpy).toHaveBeenCalledTimes(1);
    expect(tagsUpSpy).toHaveBeenCalledTimes(1);

    // 迁移 DDL 均使用裸 CREATE TABLE / ADD COLUMN / DROP COLUMN：若被重复执行必然抛错；
    // 第二次调用整体不抛错且 up 未被再次调用，即证明迁移未重复执行。
    const db2 = initDatabase(dbPath);
    expect(upSpy).toHaveBeenCalledTimes(1);
    expect(attachmentUpSpy).toHaveBeenCalledTimes(1);
    expect(dropTypeUpSpy).toHaveBeenCalledTimes(1);
    expect(tagsUpSpy).toHaveBeenCalledTimes(1);

    const logged = db2
      .prepare('SELECT name FROM _migrations ORDER BY name')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(logged).toEqual([
      '0001_init',
      '0002_attachment',
      '0003_drop_type',
      '0004_tags',
      '0005_analyses',
      '0006_analyses_grade',
    ]);

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

describe('迁移 0004_tags', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-migration-0004-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('迁移后 tags 表含 id/name/color/created_at 四列且 name 有 UNIQUE 索引，records 含 tags 列（NOT NULL、缺省 []）', () => {
    const db = initDatabase(dbPath);

    const tagCols = db
      .prepare('PRAGMA table_info(tags)')
      .all() as unknown as Array<{ name: string; notnull: number }>;
    expect(tagCols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'color', 'created_at']),
    );

    const uniqueIndex = (
      db.prepare('PRAGMA index_list(tags)').all() as unknown as Array<{
        name: string;
        unique: number;
      }>
    ).find((idx) => idx.unique === 1);
    expect(uniqueIndex).toBeDefined();
    const indexCols = db
      .prepare(`PRAGMA index_info(${uniqueIndex!.name})`)
      .all() as unknown as Array<{ name: string }>;
    expect(indexCols.map((c) => c.name)).toContain('name');

    const recordCols = db
      .prepare('PRAGMA table_info(records)')
      .all() as unknown as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const tagsCol = recordCols.find((c) => c.name === 'tags');
    expect(tagsCol).toBeDefined();
    expect(tagsCol!.notnull).toBe(1);
    expect(tagsCol!.dflt_value).toBe(`'[]'`);

    db.close();
  });

  it('旧库（0003 态已有记录行）升级后旧行 tags 读出 []，新行缺省 []', async () => {
    // 手工构造仅应用 0001~0003 的"旧库"并写入记录行
    const oldDb = new Database(dbPath);
    oldDb.pragma('foreign_keys = ON');
    await migration.up({ context: oldDb });
    await attachmentMigration.up({ context: oldDb });
    await dropTypeMigration.up({ context: oldDb });
    oldDb.prepare(`INSERT INTO records (text) VALUES ('旧记录')`).run();
    oldDb.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(migration.name);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(attachmentMigration.name);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(dropTypeMigration.name);
    oldDb.close();

    // 再次 initDatabase：应跳过 0001~0003、仅应用 0004
    const db = initDatabase(dbPath);

    const oldRow = db.prepare(`SELECT tags FROM records WHERE text = '旧记录'`).get() as {
      tags: string;
    };
    expect(oldRow.tags).toBe('[]');

    db.prepare(`INSERT INTO records (text) VALUES ('新记录')`).run();
    const newRow = db.prepare(`SELECT tags FROM records WHERE text = '新记录'`).get() as {
      tags: string;
    };
    expect(newRow.tags).toBe('[]');

    db.close();
  });

  it('migration.down() 后 tags 表与 records.tags 列均消失', async () => {
    const db = initDatabase(dbPath);
    db.prepare(`INSERT INTO tags (name, color) VALUES ('工作', '#f59e0b')`).run();
    db.prepare(`INSERT INTO records (text, tags) VALUES ('带标签', '["工作"]')`).run();

    await tagsMigration.down({ context: db });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tags'")
      .all();
    expect(tables).toEqual([]);

    const recordCols = db
      .prepare('PRAGMA table_info(records)')
      .all() as unknown as Array<{ name: string }>;
    expect(recordCols.map((c) => c.name)).not.toContain('tags');

    // records 数据不受 down 影响
    expect(
      (db.prepare(`SELECT COUNT(*) AS count FROM records`).get() as { count: number }).count,
    ).toBe(1);

    db.close();
  });
});

describe('迁移 0005_analyses', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-migration-0005-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('迁移后 analyses 表含 record_id/summary/model/created_at 四列，summary、model 为 NOT NULL，record_id 为 PK 且 FK 指向 records(id) 级联删除', () => {
    const db = initDatabase(dbPath);

    const cols = db
      .prepare('PRAGMA table_info(analyses)')
      .all() as unknown as Array<{ name: string; notnull: number; pk: number }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['record_id', 'summary', 'model', 'created_at']),
    );
    expect(cols.find((c) => c.name === 'summary')?.notnull).toBe(1);
    expect(cols.find((c) => c.name === 'model')?.notnull).toBe(1);
    expect(cols.find((c) => c.name === 'record_id')?.pk).toBe(1);

    const fks = db
      .prepare('PRAGMA foreign_key_list(analyses)')
      .all() as unknown as Array<{ table: string; from: string; to: string; on_delete: string }>;
    const recordFk = fks.find((fk) => fk.from === 'record_id');
    expect(recordFk).toBeDefined();
    expect(recordFk!.table).toBe('records');
    expect(recordFk!.to).toBe('id');
    expect(recordFk!.on_delete).toBe('CASCADE');

    db.close();
  });

  it('旧库（0004 态已有记录行）升级后现有记录不受影响（无摘要、行数不变）', () => {
    // 手工构造仅应用 0001~0004 的"旧库"并写入记录行
    const oldDb = new Database(dbPath);
    oldDb.pragma('foreign_keys = ON');
    void migration.up({ context: oldDb });
    void attachmentMigration.up({ context: oldDb });
    void dropTypeMigration.up({ context: oldDb });
    void tagsMigration.up({ context: oldDb });
    oldDb.prepare(`INSERT INTO records (text) VALUES ('旧记录')`).run();
    oldDb.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(migration.name);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(attachmentMigration.name);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(dropTypeMigration.name);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(tagsMigration.name);
    oldDb.close();

    // 再次 initDatabase：应跳过 0001~0004、仅应用 0005
    const db = initDatabase(dbPath);

    const analysesTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'analyses'")
      .all();
    expect(analysesTables).toHaveLength(1);

    const oldRow = db.prepare(`SELECT text FROM records WHERE text = '旧记录'`).get() as {
      text: string;
    };
    expect(oldRow.text).toBe('旧记录');
    expect(
      (db.prepare(`SELECT COUNT(*) AS count FROM records`).get() as { count: number }).count,
    ).toBe(1);

    db.close();
  });

  it('migration.down() 后 analyses 表消失，records 数据不受影响', async () => {
    const db = initDatabase(dbPath);
    db.prepare(`INSERT INTO records (text) VALUES ('带摘要的记录')`).run();
    const recordId = Number(
      (db.prepare(`SELECT id FROM records WHERE text = '带摘要的记录'`).get() as { id: number }).id,
    );
    db.prepare(`INSERT INTO analyses (record_id, summary, model) VALUES (?, ?, ?)`).run(
      recordId,
      '一句话摘要',
      'kimi-k2.6',
    );

    await analysesMigration.down({ context: db });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'analyses'")
      .all();
    expect(tables).toEqual([]);

    expect(
      (db.prepare(`SELECT COUNT(*) AS count FROM records`).get() as { count: number }).count,
    ).toBe(1);

    db.close();
  });
});

describe('迁移 0006_analyses_grade', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-migration-0006-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('迁移后 analyses 表含可空 grade 列（无默认值、无 CHECK）', () => {
    const db = initDatabase(dbPath);

    const cols = db
      .prepare('PRAGMA table_info(analyses)')
      .all() as unknown as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const gradeCol = cols.find((c) => c.name === 'grade');
    expect(gradeCol).toBeDefined();
    expect(gradeCol!.notnull).toBe(0);
    expect(gradeCol!.dflt_value).toBeNull();

    db.close();
  });

  it('旧库（0005 态已有 analyses 行，grade 缺省）升级后现有行不受影响（grade 读出 NULL）', () => {
    // 手工构造仅应用 0001~0005 的"旧库"并写入 records + analyses 行
    const oldDb = new Database(dbPath);
    oldDb.pragma('foreign_keys = ON');
    void migration.up({ context: oldDb });
    void attachmentMigration.up({ context: oldDb });
    void dropTypeMigration.up({ context: oldDb });
    void tagsMigration.up({ context: oldDb });
    void analysesMigration.up({ context: oldDb });
    oldDb.prepare(`INSERT INTO records (text) VALUES ('旧记录')`).run();
    const oldRecordId = Number(
      (oldDb.prepare(`SELECT id FROM records WHERE text = '旧记录'`).get() as { id: number }).id,
    );
    oldDb.prepare(`INSERT INTO analyses (record_id, summary, model) VALUES (?, ?, ?)`).run(
      oldRecordId,
      '旧摘要',
      'kimi-k2.6',
    );
    oldDb.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);
    for (const name of [
      migration.name,
      attachmentMigration.name,
      dropTypeMigration.name,
      tagsMigration.name,
      analysesMigration.name,
    ]) {
      oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(name);
    }
    oldDb.close();

    // 再次 initDatabase：应跳过 0001~0005、仅应用 0006
    const db = initDatabase(dbPath);

    const oldAnalysis = db
      .prepare(`SELECT summary, grade FROM analyses WHERE record_id = ?`)
      .get(oldRecordId) as { summary: string; grade: string | null };
    expect(oldAnalysis.summary).toBe('旧摘要');
    expect(oldAnalysis.grade).toBeNull();

    // 新行可写 grade（可空列允许带/不带 grade 写入）
    db.prepare(`INSERT INTO records (text) VALUES ('新记录')`).run();
    const newRecordId = Number(
      (db.prepare(`SELECT id FROM records WHERE text = '新记录'`).get() as { id: number }).id,
    );
    db.prepare(`INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, ?, ?)`).run(
      newRecordId,
      '新摘要',
      'kimi-k2.6',
      'high',
    );
    const newAnalysis = db
      .prepare(`SELECT grade FROM analyses WHERE record_id = ?`)
      .get(newRecordId) as { grade: string };
    expect(newAnalysis.grade).toBe('high');

    db.close();
  });

  it('migration.down() 后 analyses 表不再含 grade 列，既有 summary 数据保留', async () => {
    const db = initDatabase(dbPath);
    db.prepare(`INSERT INTO records (text) VALUES ('带分级的记录')`).run();
    const recordId = Number(
      (db.prepare(`SELECT id FROM records WHERE text = '带分级的记录'`).get() as { id: number })
        .id,
    );
    db.prepare(`INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, ?, ?)`).run(
      recordId,
      '一句话摘要',
      'kimi-k2.6',
      'mid',
    );

    await analysesGradeMigration.down({ context: db });

    const cols = db
      .prepare('PRAGMA table_info(analyses)')
      .all() as unknown as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).not.toContain('grade');
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['record_id', 'summary', 'model', 'created_at']),
    );

    const row = db
      .prepare(`SELECT summary, model FROM analyses WHERE record_id = ?`)
      .get(recordId) as { summary: string; model: string };
    expect(row).toEqual({ summary: '一句话摘要', model: 'kimi-k2.6' });

    db.close();
  });
});

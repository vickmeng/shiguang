import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase } from '../db';
import { migration as initMigration } from '../migrations/0001_init';
import {
  createCapture,
  createCaptureWithAttachments,
  deleteCaptures,
  getById,
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

  it('写入后 imagePaths 恒为 []（纯文字记录无附件）', () => {
    const record = createCapture({ text: 'hello shiguang' });

    expect(record.imagePaths).toEqual([]);
  });

  it('sourceApp 传入时原样保存', () => {
    const record = createCapture({ text: 'hi', sourceApp: 'WeChat' });

    expect(record.sourceApp).toBe('WeChat');
  });

  it('tags 缺省读回 []', () => {
    const record = createCapture({ text: '无标签' });

    expect(record.tags).toEqual([]);
  });

  it('document 传入时原样读回（Lexical EditorState JSON）', () => {
    const record = createCapture({
      text: '带版式',
      document: '{"root":{"children":[]}}',
    });

    expect(record.document).toBe('{"root":{"children":[]}}');
  });

  it('document 缺省读回 null', () => {
    const record = createCapture({ text: '无版式' });

    expect(record.document).toBeNull();
  });

  it('tags 传入时 JSON 落库，listCaptures 读回相等数组', () => {
    createCapture({ text: '带标签', tags: ['工作', '灵感'] });

    const records = listCaptures();
    expect(records).toHaveLength(1);
    expect(records[0].tags).toEqual(['工作', '灵感']);
  });
});

describe('createCaptureWithAttachments 纯图记录等价语义', () => {
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

  it('单事务写入：records 行（text=\'\'/source_app=null）与 attachments 行同时存在且 record_id 关联', () => {
    const record = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/abc.png', sizeBytes: 1234 }],
    });

    expect(record.id).toBeGreaterThan(0);
    expect(record.text).toBe('');
    expect(record.sourceApp).toBeNull();
    expect(record.imagePaths).toEqual(['images/abc.png']);
    expect(record.createdAt).toBeTruthy();

    const recordRow = db
      .prepare(`SELECT text, source_app FROM records WHERE id = ?`)
      .get(record.id) as { text: string; source_app: string };
    expect(recordRow).toEqual({
      text: '',
      source_app: null,
    });

    const attachmentRow = db
      .prepare(
        `SELECT record_id, file_path, size_bytes, mime_type FROM attachments WHERE record_id = ?`,
      )
      .get(record.id) as {
      record_id: number;
      file_path: string;
      size_bytes: number;
      mime_type: string;
    };
    expect(attachmentRow).toEqual({
      record_id: record.id,
      file_path: 'images/abc.png',
      size_bytes: 1234,
      mime_type: 'image/png',
    });
  });

  it('sizeBytes 缺省为 null', () => {
    const record = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/no-size.png' }],
    });

    const attachmentRow = db
      .prepare(`SELECT size_bytes FROM attachments WHERE record_id = ?`)
      .get(record.id) as { size_bytes: number | null };
    expect(attachmentRow.size_bytes).toBeNull();
  });

  it('listCaptures 经 LEFT JOIN 返回该记录的 imagePaths，文字记录为 []', () => {
    createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/join.png', sizeBytes: 1 }],
    });
    createCapture({ text: '文字记录' });

    const records = listCaptures();
    const image = records.find((r) => r.imagePaths.length > 0);
    const text = records.find((r) => r.text === '文字记录');

    expect(image?.imagePaths).toEqual(['images/join.png']);
    expect(text?.imagePaths).toEqual([]);
  });

  it('事务性：attachments 插入失败时 records 行也不残留（触发器强制失败）', () => {
    // 触发器强制 attachments 写入失败，验证单事务回滚、两表一致
    db.exec(`
      CREATE TRIGGER force_attachments_fail
      BEFORE INSERT ON attachments
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment failure');
      END;
    `);

    expect(() =>
      createCaptureWithAttachments({
        text: '',
        sourceApp: null,
        attachments: [{ filePath: 'images/x.png', sizeBytes: 1 }],
      }),
    ).toThrow();

    expect(db.prepare(`SELECT COUNT(*) AS count FROM records`).get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM attachments`).get(),
    ).toEqual({ count: 0 });
  });
});

describe('createCaptureWithAttachments', () => {
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

  it('单事务写入一条 record + N 行 attachments，imagePaths 按输入顺序组装', () => {
    const record = createCaptureWithAttachments({
      text: '图文混排',
      sourceApp: 'WeChat',
      attachments: [
        { filePath: 'images/one.png', sizeBytes: 100 },
        { filePath: 'images/two.png' },
        { filePath: 'images/three.png', sizeBytes: 300 },
      ],
    });

    expect(record.id).toBeGreaterThan(0);
    expect(record.text).toBe('图文混排');
    expect(record.sourceApp).toBe('WeChat');
    expect(record.createdAt).toBeTruthy();
    expect(record.imagePaths).toEqual([
      'images/one.png',
      'images/two.png',
      'images/three.png',
    ]);

    const recordRow = db
      .prepare(`SELECT text, source_app, document FROM records WHERE id = ?`)
      .get(record.id) as { text: string; source_app: string | null; document: string | null };
    expect(recordRow).toEqual({
      text: '图文混排',
      source_app: 'WeChat',
      document: null,
    });

    const attachmentRows = db
      .prepare(
        `SELECT file_path, size_bytes, mime_type FROM attachments WHERE record_id = ? ORDER BY id`,
      )
      .all(record.id) as unknown as Array<{
      file_path: string;
      size_bytes: number | null;
      mime_type: string;
    }>;
    expect(attachmentRows).toEqual([
      { file_path: 'images/one.png', size_bytes: 100, mime_type: 'image/png' },
      { file_path: 'images/two.png', size_bytes: null, mime_type: 'image/png' },
      { file_path: 'images/three.png', size_bytes: 300, mime_type: 'image/png' },
    ]);
  });

  it('document 传入时原样写入 document 列，缺省为 null', () => {
    const withDoc = createCaptureWithAttachments({
      text: '有版式',
      document: '{"root":{"children":[]}}',
      attachments: [],
    });
    const withoutDoc = createCaptureWithAttachments({
      text: '无版式',
      attachments: [],
    });

    const rows = db
      .prepare(`SELECT id, document FROM records WHERE id IN (?, ?) ORDER BY id`)
      .all(withDoc.id, withoutDoc.id) as unknown as Array<{
      id: number;
      document: string | null;
    }>;
    expect(withDoc.document).toBe('{"root":{"children":[]}}');
    expect(withoutDoc.document).toBeNull();

    expect(rows.find((r) => r.id === withDoc.id)?.document).toBe(
      '{"root":{"children":[]}}',
    );
    expect(rows.find((r) => r.id === withoutDoc.id)?.document).toBeNull();
  });

  it('单事务返回的 record 与 listCaptures 读回的 document 一致', () => {
    createCaptureWithAttachments({
      text: '图文版式',
      document: '{"root":{"children":[{"type":"image","src":"images/in-doc.png"}]}}',
      attachments: [{ filePath: 'images/in-doc.png', sizeBytes: 1 }],
    });

    const found = listCaptures().find((r) => r.text === '图文版式');
    expect(found?.document).toBe(
      '{"root":{"children":[{"type":"image","src":"images/in-doc.png"}]}}',
    );
  });

  it('text 为 \'\' 且 N 图（纯图记录）可写入，imagePaths 顺序正确', () => {
    const record = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [
        { filePath: 'images/a.png', sizeBytes: 1 },
        { filePath: 'images/b.png', sizeBytes: 2 },
      ],
    });

    expect(record.text).toBe('');
    expect(record.sourceApp).toBeNull();
    expect(record.imagePaths).toEqual(['images/a.png', 'images/b.png']);
    expect(
      (db.prepare(`SELECT COUNT(*) AS count FROM records`).get() as { count: number }).count,
    ).toBe(1);
  });

  it('tags 缺省读回 []', () => {
    const record = createCaptureWithAttachments({ text: '图文', attachments: [] });

    expect(record.tags).toEqual([]);
  });

  it('tags 传入时单事务写入，返回记录与 listCaptures 读回一致', () => {
    const record = createCaptureWithAttachments({
      text: '图文带标签',
      sourceApp: null,
      tags: ['工作', '灵感'],
      attachments: [{ filePath: 'images/tagged.png', sizeBytes: 1 }],
    });

    expect(record.tags).toEqual(['工作', '灵感']);

    const row = db
      .prepare(`SELECT tags FROM records WHERE id = ?`)
      .get(record.id) as { tags: string };
    expect(row.tags).toBe('["工作","灵感"]');

    const found = listCaptures().find((r) => r.id === record.id);
    expect(found?.tags).toEqual(['工作', '灵感']);
  });

  it('事务性：第二个 attachment 插入失败时 records 行一并回滚（库零记录）', () => {
    // 触发器强制第二张附件写入失败，验证单事务回滚、两表一致
    db.exec(`
      CREATE TRIGGER fail_second_attachment
      BEFORE INSERT ON attachments
      WHEN (SELECT COUNT(*) FROM attachments) >= 1
      BEGIN
        SELECT RAISE(ABORT, 'forced second attachment failure');
      END;
    `);

    expect(() =>
      createCaptureWithAttachments({
        text: 'x',
        attachments: [
          { filePath: 'images/a.png', sizeBytes: 1 },
          { filePath: 'images/b.png', sizeBytes: 2 },
        ],
      }),
    ).toThrow();

    expect(db.prepare(`SELECT COUNT(*) AS count FROM records`).get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM attachments`).get(),
    ).toEqual({ count: 0 });
  });
});

describe('createCaptureWithAttachments analysis 写入（analyses 表）', () => {
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

  function analysesCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS count FROM analyses`).get() as { count: number })
      .count;
  }

  // 注：listCaptures 读回 aiSummary 属任务 3（读取侧 JOIN）范围，本组用例直查
  // analyses 表验证写侧语义。
  it('传入 analysis 时 analyses 行随记录同事务写入（直查 analyses 表读回 summary/model）', () => {
    const record = createCaptureWithAttachments({
      text: '图文混排',
      attachments: [{ filePath: 'images/summary.png', sizeBytes: 1 }],
      analysis: { summary: '一句话', model: 'kimi-k2.6' },
    });

    const row = db
      .prepare(`SELECT record_id, summary, model FROM analyses WHERE record_id = ?`)
      .get(record.id) as { record_id: number; summary: string; model: string };
    expect(row).toEqual({ record_id: record.id, summary: '一句话', model: 'kimi-k2.6' });
  });

  it('analysis 携带 grade 时写入 analyses.grade，读回 aiGrade 为对应枚举值', () => {
    const record = createCaptureWithAttachments({
      text: '观点记录',
      attachments: [{ filePath: 'images/graded.png', sizeBytes: 1 }],
      analysis: { summary: '一句话', model: 'kimi-k2.6', grade: 'high' },
    });

    const row = db
      .prepare(`SELECT grade FROM analyses WHERE record_id = ?`)
      .get(record.id) as { grade: string | null };
    expect(row.grade).toBe('high');

    expect(listCaptures().find((r) => r.id === record.id)?.aiGrade).toBe('high');
  });

  it('grade 缺省时存 NULL（读回 aiGrade 为 null，analyses.grade 为 null）', () => {
    const record = createCaptureWithAttachments({
      text: '未分级',
      attachments: [{ filePath: 'images/no-grade.png', sizeBytes: 1 }],
      analysis: { summary: '一句话', model: 'kimi-k2.6' },
    });

    const row = db
      .prepare(`SELECT grade FROM analyses WHERE record_id = ?`)
      .get(record.id) as { grade: string | null };
    expect(row.grade).toBeNull();
    expect(listCaptures().find((r) => r.id === record.id)?.aiGrade).toBeNull();
  });

  it('grade 显式传 null 时存 NULL', () => {
    const record = createCaptureWithAttachments({
      text: '显式空分级',
      attachments: [{ filePath: 'images/null-grade.png', sizeBytes: 1 }],
      analysis: { summary: '一句话', model: 'kimi-k2.6', grade: null },
    });

    const row = db
      .prepare(`SELECT grade FROM analyses WHERE record_id = ?`)
      .get(record.id) as { grade: string | null };
    expect(row.grade).toBeNull();
    expect(listCaptures().find((r) => r.id === record.id)?.aiGrade).toBeNull();
  });

  it('事务性：attachments 插入失败时携带 grade 的 analyses 行也不残留（三表一致回滚）', () => {
    db.exec(`
      CREATE TRIGGER force_attachments_fail_for_grade
      BEFORE INSERT ON attachments
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment failure');
      END;
    `);

    expect(() =>
      createCaptureWithAttachments({
        text: 'x',
        attachments: [{ filePath: 'images/x.png', sizeBytes: 1 }],
        analysis: { summary: '一句话', model: 'kimi-k2.6', grade: 'high' },
      }),
    ).toThrow();

    expect(db.prepare(`SELECT COUNT(*) AS count FROM records`).get()).toEqual({ count: 0 });
    expect(analysesCount()).toBe(0);
  });

  it('analysis 缺省时不写 analyses 行，记录正常返回', () => {
    const record = createCaptureWithAttachments({
      text: '无摘要',
      attachments: [{ filePath: 'images/no-analysis.png', sizeBytes: 1 }],
    });

    expect(analysesCount()).toBe(0);
    expect(record.text).toBe('无摘要');
    expect(record.imagePaths).toEqual(['images/no-analysis.png']);
  });

  it('事务性：attachments 插入失败时 analyses 行也不残留（三表一致回滚）', () => {
    db.exec(`
      CREATE TRIGGER force_attachments_fail_for_analysis
      BEFORE INSERT ON attachments
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment failure');
      END;
    `);

    expect(() =>
      createCaptureWithAttachments({
        text: 'x',
        attachments: [{ filePath: 'images/x.png', sizeBytes: 1 }],
        analysis: { summary: '一句话', model: 'kimi-k2.6' },
      }),
    ).toThrow();

    expect(db.prepare(`SELECT COUNT(*) AS count FROM records`).get()).toEqual({ count: 0 });
    expect(analysesCount()).toBe(0);
  });

  it('删除记录后 analyses 行随外键 CASCADE 级联消失', () => {
    const record = createCaptureWithAttachments({
      text: '待删除',
      attachments: [],
      analysis: { summary: '一句话', model: 'kimi-k2.6' },
    });
    expect(analysesCount()).toBe(1);

    deleteCaptures([record.id]);

    expect(analysesCount()).toBe(0);
  });
});

describe('读取侧 aiSummary（listCaptures / queryCaptures LEFT JOIN analyses）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('带 analysis 记录经 listCaptures 读回 aiSummary', () => {
    createCaptureWithAttachments({
      text: '图文混排',
      attachments: [{ filePath: 'images/summary.png', sizeBytes: 1 }],
      analysis: { summary: '一句话', model: 'kimi-k2.6' },
    });

    const found = listCaptures().find((r) => r.text === '图文混排');
    expect(found?.aiSummary).toBe('一句话');
  });

  it('带 analysis 记录经 queryCaptures 读回 aiSummary，total 不回退', () => {
    createCaptureWithAttachments({
      text: '关键词 图文',
      attachments: [{ filePath: 'images/q.png', sizeBytes: 1 }],
      analysis: { summary: '查询摘要', model: 'kimi-k2.6' },
    });
    createCapture({ text: '无关文字' });

    const result = queryCaptures({ keyword: '关键词', page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items[0].aiSummary).toBe('查询摘要');
  });

  it('无摘要记录读回 aiSummary 为 null', () => {
    createCapture({ text: '纯文字' });
    createCaptureWithAttachments({
      text: '无摘要图文',
      attachments: [{ filePath: 'images/no-summary.png', sizeBytes: 1 }],
    });

    const records = listCaptures();
    expect(records.find((r) => r.text === '纯文字')?.aiSummary).toBeNull();
    expect(records.find((r) => r.text === '无摘要图文')?.aiSummary).toBeNull();
  });

  it('多附件记录的 aiSummary 在多个 JOIN 行下聚合正确（恰一行值，1:1 无行膨胀）', () => {
    createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [
        { filePath: 'images/m1.png', sizeBytes: 1 },
        { filePath: 'images/m2.png', sizeBytes: 2 },
        { filePath: 'images/m3.png', sizeBytes: 3 },
      ],
      analysis: { summary: '多图摘要', model: 'kimi-k2.6' },
    });

    const records = listCaptures();

    expect(records).toHaveLength(1);
    expect(records[0].imagePaths).toEqual(['images/m1.png', 'images/m2.png', 'images/m3.png']);
    expect(records[0].aiSummary).toBe('多图摘要');
  });
});

describe('读取侧 aiGrade（LEFT JOIN analyses.grade）', () => {
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

  /** 手工直插 analyses 行（含 grade），绕开写侧 DAO（写侧属任务 5 范围）。 */
  function insertAnalysis(
    recordId: number,
    summary: string,
    grade: string | null,
  ): void {
    db.prepare(
      `INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, 'kimi-k2.6', ?)`,
    ).run(recordId, summary, grade);
  }

  it('手工 INSERT 含 grade 的行后，listCaptures / queryCaptures / getById 读回对应枚举值', () => {
    const high = createCapture({ text: '观点记录' });
    const mid = createCapture({ text: '日常记录' });
    insertAnalysis(high.id, '观点摘要', 'high');
    insertAnalysis(mid.id, '日常摘要', 'mid');

    expect(listCaptures().find((r) => r.id === high.id)?.aiGrade).toBe('high');
    expect(listCaptures().find((r) => r.id === mid.id)?.aiGrade).toBe('mid');

    const queried = queryCaptures({ keyword: '日常', page: 1, pageSize: 10 });
    expect(queried.items[0].aiGrade).toBe('mid');

    expect(getById(high.id)?.aiGrade).toBe('high');
  });

  it('grade 为 NULL 的行读回 aiGrade 为 null', () => {
    const record = createCapture({ text: '未分级' });
    insertAnalysis(record.id, '无分级摘要', null);

    expect(listCaptures()[0].aiGrade).toBeNull();
    expect(getById(record.id)?.aiGrade).toBeNull();
  });

  it('无 analyses 行的记录读回 aiGrade 为 null', () => {
    createCapture({ text: '纯文字' });

    expect(listCaptures()[0].aiGrade).toBeNull();
  });

  it('createCapture 纯文字直写返回的记录 aiGrade 为 null（RETURNING 补 NULL 列）', () => {
    const record = createCapture({ text: 'hello shiguang' });

    expect(record.aiGrade).toBeNull();
  });

  it('createCaptureWithAttachments 不带 analysis 时返回记录 aiGrade 为 null', () => {
    const record = createCaptureWithAttachments({
      text: '无摘要图文',
      attachments: [{ filePath: 'images/no-grade.png', sizeBytes: 1 }],
    });

    expect(record.aiGrade).toBeNull();
  });

  it('多附件记录 aiGrade 在多个 JOIN 行下聚合正确（1:1 无行膨胀）', () => {
    const record = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [
        { filePath: 'images/g1.png', sizeBytes: 1 },
        { filePath: 'images/g2.png', sizeBytes: 2 },
      ],
    });
    insertAnalysis(record.id, '多图分级摘要', 'low');

    const found = listCaptures()[0];
    expect(found.imagePaths).toEqual(['images/g1.png', 'images/g2.png']);
    expect(found.aiGrade).toBe('low');
  });

  it('queryCaptures 在 keyword 过滤下读回 aiGrade（JOIN 条件不干扰分级列）', () => {
    const target = createCapture({ text: '关键词 分级' });
    const other = createCapture({ text: '无关' });
    insertAnalysis(target.id, '目标摘要', 'high');
    insertAnalysis(other.id, '无关摘要', 'low');

    const result = queryCaptures({ keyword: '关键词', page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items[0].aiGrade).toBe('high');
  });
});

describe('getById', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupDb().tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('命中返回完整记录（含 aiSummary 与有序 imagePaths）', () => {
    const record = createCaptureWithAttachments({
      text: '图文混排',
      sourceApp: 'WeChat',
      tags: ['工作'],
      attachments: [
        { filePath: 'images/a.png', sizeBytes: 1 },
        { filePath: 'images/b.png', sizeBytes: 2 },
      ],
      analysis: { summary: '一句话', model: 'kimi-k2.6' },
    });

    const found = getById(record.id);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(record.id);
    expect(found?.text).toBe('图文混排');
    expect(found?.sourceApp).toBe('WeChat');
    expect(found?.tags).toEqual(['工作']);
    expect(found?.aiSummary).toBe('一句话');
    expect(found?.imagePaths).toEqual(['images/a.png', 'images/b.png']);
  });

  it('纯文字记录命中时 imagePaths 为 []、aiSummary 为 null', () => {
    const record = createCapture({ text: '纯文字' });

    const found = getById(record.id);

    expect(found?.imagePaths).toEqual([]);
    expect(found?.aiSummary).toBeNull();
  });

  it('未命中返回 null', () => {
    createCapture({ text: '存在' });

    expect(getById(999)).toBeNull();
  });
});

describe('listCaptures', () => {
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

  it('无附件记录 imagePaths 为 []', () => {
    createCapture({ text: '文字记录', sourceApp: null });

    const records = listCaptures();

    expect(records).toHaveLength(1);
    expect(records[0].imagePaths).toEqual([]);
  });

  it('一记录多附件聚合为有序 imagePaths 数组（attachments.id 升序）', () => {
    const image = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/first.png', sizeBytes: 1 }],
    });
    db.prepare(
      `INSERT INTO attachments (record_id, file_path, size_bytes, created_at)
       VALUES (?, 'images/second.png', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).run(image.id);
    db.prepare(
      `INSERT INTO attachments (record_id, file_path, size_bytes, created_at)
       VALUES (?, 'images/third.png', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).run(image.id);

    const found = listCaptures().find((r) => r.id === image.id);

    expect(found?.imagePaths).toEqual([
      'images/first.png',
      'images/second.png',
      'images/third.png',
    ]);
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

  /** 以固定 created_at 直插图片记录（records + attachments 行）。 */
  function insertImageWithTime(filePath: string, createdAt: string): number {
    const row = db
      .prepare(
        `INSERT INTO records (text, source_app, created_at)
         VALUES ('', 'screenshot', ?)`,
      )
      .run(createdAt);
    const recordId = Number(row.lastInsertRowid);
    db.prepare(
      `INSERT INTO attachments (record_id, file_path, created_at) VALUES (?, ?, ?)`,
    ).run(recordId, filePath, createdAt);
    return recordId;
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

  it('hasImages=false 仅返回无图记录，total 与 items 同条件', () => {
    seedRecords();
    insertImageWithTime('images/shot-1.png', '2026-01-08T08:00:00.000Z');

    const result = queryCaptures({ hasImages: false, page: 1, pageSize: 10 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((r) => r.imagePaths.length === 0)).toBe(true);
  });

  it('hasImages=true 仅返回含图记录（imagePaths 为相对路径数组）', () => {
    seedRecords();
    insertImageWithTime('images/shot-1.png', '2026-01-08T08:00:00.000Z');
    insertImageWithTime('images/shot-2.png', '2026-01-02T08:00:00.000Z');

    const result = queryCaptures({ hasImages: true, page: 1, pageSize: 10 });

    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.imagePaths)).toEqual([
      ['images/shot-1.png'],
      ['images/shot-2.png'],
    ]);
    expect(result.items.map((r) => r.text)).toEqual(['', '']);
    expect(result.items.map((r) => r.sourceApp)).toEqual(['screenshot', 'screenshot']);
  });

  it('queryCaptures 读回 document 列（带版式与无版式记录并存）', () => {
    createCapture({ text: '纯文字', document: null });
    createCaptureWithAttachments({
      text: '混排目标',
      document: '{"root":{"children":[]}}',
      attachments: [{ filePath: 'images/doc.png', sizeBytes: 1 }],
    });

    const result = queryCaptures({ keyword: '目标', page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items[0].document).toBe('{"root":{"children":[]}}');

    const all = queryCaptures({ page: 1, pageSize: 10 });
    const textRecord = all.items.find((r) => r.text === '纯文字');
    expect(textRecord?.document).toBeNull();
  });

  it('一记录多附件聚合为有序 imagePaths 数组（attachments.id 升序）', () => {
    seedRecords();
    const recordId = insertImageWithTime('images/m-1.png', '2026-01-08T08:00:00.000Z');
    db.prepare(
      `INSERT INTO attachments (record_id, file_path, created_at)
       VALUES (?, 'images/m-2.png', '2026-01-08T08:00:00.000Z')`,
    ).run(recordId);

    const result = queryCaptures({ hasImages: true, page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items[0].imagePaths).toEqual(['images/m-1.png', 'images/m-2.png']);
  });

  it('缺省 hasImages 返回全部记录（有图与无图混合）', () => {
    seedRecords();
    insertImageWithTime('images/shot-1.png', '2026-01-08T08:00:00.000Z');

    const result = queryCaptures({ page: 1, pageSize: 10 });

    expect(result.total).toBe(4);
    expect(
      result.items.map((r) => (r.imagePaths.length > 0 ? 'image' : 'text')).sort(),
    ).toEqual(['image', 'text', 'text', 'text']);
  });

  it('hasImages 与 keyword 组合：条件同取交集', () => {
    seedRecords();
    insertImageWithTime('images/shot.png', '2026-01-08T08:00:00.000Z');

    const texts = queryCaptures({ keyword: '目标', hasImages: false, page: 1, pageSize: 10 });
    expect(texts.total).toBe(2);
    expect(texts.items.every((r) => r.imagePaths.length === 0)).toBe(true);

    // 图片记录 text=''，keyword 仅匹配文字列，hasImages=true 时无交集
    const images = queryCaptures({ keyword: '目标', hasImages: true, page: 1, pageSize: 10 });
    expect(images.total).toBe(0);
    expect(images.items).toEqual([]);
  });

  it('tagNames 多值任一命中 OR：tagNames 含全部标签时命中三条，单值命中两条', () => {
    createCapture({ text: '仅工作', tags: ['工作'] });
    createCapture({ text: '仅灵感', tags: ['灵感'] });
    createCapture({ text: '两者都有', tags: ['工作', '灵感'] });

    const all = queryCaptures({ tagNames: ['工作', '灵感'], page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((r) => r.text).sort()).toEqual(['两者都有', '仅工作', '仅灵感']);

    const onlyWork = queryCaptures({ tagNames: ['工作'], page: 1, pageSize: 10 });
    expect(onlyWork.total).toBe(2);
    expect(onlyWork.items.map((r) => r.text).sort()).toEqual(['两者都有', '仅工作']);
  });

  it('tagNames 无匹配项时 total 为 0、items 为空', () => {
    createCapture({ text: '仅工作', tags: ['工作'] });
    createCapture({ text: '仅灵感', tags: ['灵感'] });

    const result = queryCaptures({ tagNames: ['不存在'], page: 1, pageSize: 10 });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('tagNames 空数组或 undefined 不生效（全部返回）', () => {
    seedRecords();

    const empty = queryCaptures({ tagNames: [], page: 1, pageSize: 10 });
    expect(empty.total).toBe(3);
    expect(empty.items).toHaveLength(3);

    const omitted = queryCaptures({ page: 1, pageSize: 10 });
    expect(omitted.total).toBe(3);
    expect(omitted.items).toHaveLength(3);
  });

  it('tagNames 与 keyword 组合时条件间 AND', () => {
    createCapture({ text: '会议纪要 目标', tags: ['工作'] });
    createCapture({ text: '随想', tags: ['工作'] });
    createCapture({ text: '点子 目标', tags: ['灵感'] });

    const result = queryCaptures({ keyword: '目标', tagNames: ['工作'], page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.text)).toEqual(['会议纪要 目标']);
  });

  it('tagNames 查询下 total 与 items 同条件（OR 命中总数）', () => {
    createCapture({ text: '仅工作', tags: ['工作'] });
    createCapture({ text: '仅灵感', tags: ['灵感'] });
    createCapture({ text: '无关', tags: ['生活'] });

    const result = queryCaptures({ tagNames: ['工作', '灵感'], page: 1, pageSize: 2 });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('tag「AI」+ 快照 ["AIGC"] 不误命中（参数带引号精确匹配）', () => {
    createCapture({ text: 'AIGC 记录', tags: ['AIGC'] });
    createCapture({ text: 'AI 记录', tags: ['AI'] });

    const result = queryCaptures({ tagNames: ['AI'], page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.text)).toEqual(['AI 记录']);
  });

  /** 手工直插 analyses 行（含 grade），绕开写侧 DAO（写侧属任务 5 范围）。 */
  function insertAnalysis(
    recordId: number,
    summary: string,
    grade: string | null,
  ): void {
    db.prepare(
      `INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, 'kimi-k2.6', ?)`,
    ).run(recordId, summary, grade);
  }

  it('grade 单值过滤：items 仅含对应级别记录且 total 只统计命中项', () => {
    const high = createCapture({ text: '观点记录' });
    const mid = createCapture({ text: '日常记录' });
    const nulled = createCapture({ text: '未分级记录' });
    insertAnalysis(high.id, '观点摘要', 'high');
    insertAnalysis(mid.id, '日常摘要', 'mid');
    insertAnalysis(nulled.id, '无分级摘要', null);

    const result = queryCaptures({ grade: 'high', page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.id)).toEqual([high.id]);
    expect(result.items[0].aiGrade).toBe('high');

    const midResult = queryCaptures({ grade: 'mid', page: 1, pageSize: 10 });
    expect(midResult.total).toBe(1);
    expect(midResult.items.map((r) => r.id)).toEqual([mid.id]);
  });

  it('grade 为 NULL 的记录在任何 grade 过滤下均不命中', () => {
    const nulled = createCapture({ text: '未分级记录' });
    const high = createCapture({ text: '观点记录' });
    insertAnalysis(nulled.id, '无分级摘要', null);
    insertAnalysis(high.id, '观点摘要', 'high');

    for (const grade of ['high', 'mid', 'low'] as const) {
      const result = queryCaptures({ grade, page: 1, pageSize: 10 });
      expect(result.items.map((r) => r.id)).not.toContain(nulled.id);
    }
    // NULL 记录也未丢失（缺省 = 全部时仍在）
    const all = queryCaptures({ page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
  });

  it('不带 grade 时全部返回（缺省 = 全部）', () => {
    const high = createCapture({ text: '观点记录' });
    const mid = createCapture({ text: '日常记录' });
    const plain = createCapture({ text: '无 analyses 行' });
    insertAnalysis(high.id, '观点摘要', 'high');
    insertAnalysis(mid.id, '日常摘要', 'mid');

    const result = queryCaptures({ page: 1, pageSize: 10 });

    expect(result.total).toBe(3);
    expect(result.items.map((r) => r.id).sort()).toEqual(
      [high.id, mid.id, plain.id].sort(),
    );
  });

  it('grade 过滤与 keyword 组合时条件间 AND', () => {
    const hit = createCapture({ text: '会议纪要 目标' });
    const wrongGrade = createCapture({ text: '随想 目标' });
    insertAnalysis(hit.id, '目标摘要', 'high');
    insertAnalysis(wrongGrade.id, '随想摘要', 'mid');

    const result = queryCaptures({
      keyword: '目标',
      grade: 'high',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.text)).toEqual(['会议纪要 目标']);
  });

  it('grade 过滤与 tagNames 组合时条件间 AND', () => {
    const hit = createCapture({ text: '工作观点', tags: ['工作'] });
    const wrongTag = createCapture({ text: '灵感观点', tags: ['灵感'] });
    insertAnalysis(hit.id, '观点摘要', 'high');
    insertAnalysis(wrongTag.id, '观点摘要', 'high');

    const result = queryCaptures({
      tagNames: ['工作'],
      grade: 'high',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.id)).toEqual([hit.id]);
  });

  it('hasImages 与 since/until 组合：条件同取交集', () => {
    seedRecords();
    insertImageWithTime('images/in-window.png', '2026-01-08T08:00:00.000Z');
    insertImageWithTime('images/out-window.png', '2026-01-12T08:00:00.000Z');

    const result = queryCaptures({
      hasImages: true,
      since: '2026-01-04T00:00:00.000Z',
      until: '2026-01-10T00:00:00.000Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items[0].imagePaths).toEqual(['images/in-window.png']);
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

describe('迁移 0003_drop_type', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-migration-0003-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('迁移后 records 表无 type 列，新增可空 document 列', () => {
    const db = setupDb().db;

    const columns = db
      .prepare(`PRAGMA table_info(records)`)
      .all() as unknown as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const names = columns.map((c) => c.name);

    expect(names).not.toContain('type');
    expect(names).toContain('document');

    const documentColumn = columns.find((c) => c.name === 'document');
    expect(documentColumn?.notnull).toBe(0);
  });

  it('迁移后 attachments 表存在，含 record_id/file_path/mime_type/size_bytes 列', () => {
    const db = setupDb().db;

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as unknown as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('attachments');

    const columns = (db.prepare(`PRAGMA table_info(attachments)`).all() as unknown as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'record_id', 'file_path', 'mime_type', 'size_bytes', 'created_at']),
    );
  });

  it('旧库（仅 0001 结构）升级后旧文字记录保留且 type 列消失', async () => {
    const dbPath = join(tmpDir, 'old.db');
    // 手工构造仅应用 0001 的"旧库"：直接执行 0001 迁移体并登记已执行名
    const oldDb = new Database(dbPath);
    oldDb.pragma('foreign_keys = ON');
    await initMigration.up({ context: oldDb });
    oldDb.prepare(`INSERT INTO records (text, source_app) VALUES (?, ?)`).run('旧文字 A', null);
    oldDb.prepare(`INSERT INTO records (text, source_app) VALUES (?, ?)`).run('旧文字 B', 'WeChat');
    oldDb.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);
    oldDb.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(initMigration.name);
    oldDb.close();

    // 再次 initDatabase：应跳过 0001、应用 0002 与 0003
    const db = initDatabase(dbPath);
    setCaptureDatabase(db);

    const rows = db.prepare(`SELECT text FROM records ORDER BY id`).all() as unknown as Array<{
      text: string;
    }>;
    expect(rows.map((r) => r.text)).toEqual(['旧文字 A', '旧文字 B']);

    const columns = (
      db.prepare(`PRAGMA table_info(records)`).all() as unknown as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).not.toContain('type');

    db.close();
  });
});

describe('deleteCaptures 级联清理附件', () => {
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

  function attachmentCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS count FROM attachments`).get() as { count: number })
      .count;
  }

  it('删除图片记录返回其附件相对路径，且 records/attachments 两表行均消失', () => {
    const image = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/xxx.png', sizeBytes: 10 }],
    });

    const paths = deleteCaptures([image.id]);

    expect(paths).toEqual(['images/xxx.png']);
    expect(listCaptures()).toHaveLength(0);
    expect(attachmentCount()).toBe(0);
  });

  it('删除纯文字记录返回空数组，不产生附件路径', () => {
    const text = createCapture({ text: '文字' });

    expect(deleteCaptures([text.id])).toEqual([]);
    expect(listCaptures()).toHaveLength(0);
    expect(attachmentCount()).toBe(0);
  });

  it('混合批量删除返回全部图片路径（顺序按传入 id 的匹配结果），文字记录不产生路径', () => {
    const textA = createCapture({ text: '文字 A' });
    const imageA = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/a.png', sizeBytes: 1 }],
    });
    const textB = createCapture({ text: '文字 B' });
    const imageB = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/b.png', sizeBytes: 2 }],
    });

    const paths = deleteCaptures([textA.id, imageA.id, textB.id, imageB.id]);

    expect(paths).toEqual(['images/a.png', 'images/b.png']);
    expect(listCaptures()).toHaveLength(0);
    expect(attachmentCount()).toBe(0);
  });

  it('空数组直接返回空数组、不抛错、不执行删除', () => {
    createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/keep.png', sizeBytes: 1 }],
    });

    expect(deleteCaptures([])).toEqual([]);
    expect(listCaptures()).toHaveLength(1);
    expect(attachmentCount()).toBe(1);
  });

  it('删除后 attachments 无悬挂 record_id（不存在于 records 的关联行）', () => {
    const image = createCaptureWithAttachments({
      text: '',
      sourceApp: null,
      attachments: [{ filePath: 'images/orphan-check.png', sizeBytes: 1 }],
    });
    const keep = createCapture({ text: '保留' });

    deleteCaptures([image.id]);

    const dangling = db
      .prepare(
        `SELECT COUNT(*) AS count FROM attachments
         WHERE record_id NOT IN (SELECT id FROM records)`,
      )
      .get() as { count: number };
    expect(dangling.count).toBe(0);
    expect(listCaptures().map((r) => r.text)).toEqual(['保留']);
    expect(keep.id).toBeGreaterThan(0);
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

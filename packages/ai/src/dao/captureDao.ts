import type Database from 'better-sqlite3';
import type { CaptureRecord } from '@shiguang/shared';

/**
 * captureDao 持有的数据库连接。
 *
 * DAO 函数契约为 (input) 形态（不含 db 参数），故连接以模块级单例方式注入：
 * 主进程启动时调用一次 setCaptureDatabase(initDatabase(dbPath))，之后 DAO 函数直接使用。
 */
let db: Database.Database | null = null;

/** 注入 DAO 使用的数据库连接（通常在主进程启动初始化时调用一次）。 */
export function setCaptureDatabase(database: Database.Database): void {
  db = database;
}

interface RecordRow {
  id: number;
  text: string;
  source_app: string | null;
  created_at: string;
}

function toRecord(row: RecordRow): CaptureRecord {
  return {
    id: row.id,
    text: row.text,
    sourceApp: row.source_app,
    createdAt: row.created_at,
  };
}

/**
 * 写入一条纯文字捕获记录，返回已入库的 CaptureRecord。
 *
 * @param input 记录内容（sourceApp 缺省为 null）
 * @returns 已入库的记录（含数据库生成的 id/createdAt）
 */
export function createCapture(
  input: { text: string; sourceApp?: string | null },
): CaptureRecord {
  if (!db) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  const row = db
    .prepare(
      `INSERT INTO records (text, source_app, created_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       RETURNING *`,
    )
    .get(input.text, input.sourceApp ?? null) as unknown as RecordRow;

  return toRecord(row);
}

/**
 * 按时间倒序返回捕获记录。
 *
 * ORDER BY created_at DESC, id DESC：created_at 为毫秒级时间戳，同毫秒并发写入时
 * 以自增 id 兜底保证顺序确定；不传 limit 时返回全部记录。
 *
 * @param limit 最多返回的条数（取最新 N 条），缺省返回全部
 */
export function listCaptures(limit?: number): CaptureRecord[] {
  if (!db) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  const selectRecords =
    limit === undefined
      ? db.prepare(`SELECT * FROM records ORDER BY created_at DESC, id DESC`)
      : db.prepare(`SELECT * FROM records ORDER BY created_at DESC, id DESC LIMIT ?`);

  const rows = (
    limit === undefined ? selectRecords.all() : selectRecords.all(limit)
  ) as unknown as RecordRow[];

  return rows.map(toRecord);
}

/**
 * 删除一条捕获记录（纯删记录，M1 无附件无需级联/磁盘清理）。
 *
 * @param id 记录 id；不存在时不抛错
 */
export function deleteCapture(id: number): void {
  if (!db) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  db.prepare(`DELETE FROM records WHERE id = ?`).run(id);
}

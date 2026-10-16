import type Database from 'better-sqlite3';
import type {
  CaptureRecord,
  QueryCapturesPayload,
  QueryCapturesResult,
} from '@shiguang/shared';

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
 * 分页筛选查询捕获记录，返回当页数据与同条件全量条数。
 *
 * 排序固定 created_at DESC, id DESC（同毫秒并发写入时以自增 id 兜底保证顺序确定）；
 * keyword 走参数化 LIKE 包含匹配，since 走 created_at >= ?，until 走 created_at <= ?
 *（含该秒），三者可任意组合（created_at 为 ISO 字符串，字典序即时间序），均按是否
 * 传入动态拼接 WHERE。total 与 items 共用同一组条件，
 * 保证分页页数计算与当页数据一致。
 *
 * @param input 分页筛选载荷（page 从 1 起算）
 * @returns { items: 当页记录, total: 同筛选条件下全部条数 }
 */
export function queryCaptures(
  input: QueryCapturesPayload,
): QueryCapturesResult {
  if (!db) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  const conditions: string[] = [];
  // 查询条件参数为 string（keyword/since），后续展开到 better-sqlite3 的
  // get/all 时与 number 类型的分页参数（pageSize/offset）混用，故声明为联合类型
  const params: Array<string | number> = [];
  if (input.keyword !== undefined) {
    conditions.push(`text LIKE '%' || ? || '%'`);
    params.push(input.keyword);
  }
  if (input.since !== undefined) {
    conditions.push(`created_at >= ?`);
    params.push(input.since);
  }
  if (input.until !== undefined) {
    conditions.push(`created_at <= ?`);
    params.push(input.until);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM records${where}`)
      .get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `SELECT * FROM records${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize) as unknown as RecordRow[];

  return { items: rows.map(toRecord), total };
}

/**
 * 单事务批量删除捕获记录（纯删记录，M1 无附件无需级联/磁盘清理）。
 *
 * @param ids 待删除的记录 id 集合；不存在的 id 静默跳过，空数组时不执行删除、不抛错
 */
export function deleteCaptures(ids: number[]): void {
  const database = db;
  if (!database) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }
  if (ids.length === 0) {
    return;
  }

  const placeholders = ids.map(() => '?').join(', ');
  database.transaction(() => {
    database.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...ids);
  })();
}

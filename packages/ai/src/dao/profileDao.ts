import type Database from 'better-sqlite3';
import type { ProfileDocument, ProfileHistoryEntry } from '@shiguang/shared';

/**
 * profileDao 持有的数据库连接。
 *
 * DAO 函数契约为 (input) 形态（不含 db 参数），故连接以模块级单例方式注入：
 * 主进程启动时调用一次 setProfileDatabase(initDatabase(dbPath))，之后 DAO 函数直接使用。
 *
 * profiles 为单例表（id 恒为 1，迁移 0007 CHECK 约束强制）：document 为
 * ProfileDocument JSON 文本，updated_at 为上次汇总成功时刻。
 * profile_history 为追加式历史快照表（迁移 0008）：每次 saveProfileWithStamp
 * 成功在同一事务追加一行，id AUTOINCREMENT 单调递增即版本序，留作日后分析。
 * analyses.profiled_at 标记某条摘要曾作为输入参与某次汇总（NULL = 未纳入）。
 *
 * 待汇总队列读取（pendingSummaries / pendingCount）：profiled_at IS NULL，
 * FIFO 按 records.created_at ASC, analyses.record_id ASC 双键排序。
 */
/** 近期记录概览：普通记录覆盖近 30 天窗口 */
const RECENT_BASE_WINDOW_DAYS = 30;
/** 近期记录概览：grade = 'high' 记录放宽到近 90 天窗口 */
const RECENT_HIGH_WINDOW_DAYS = 90;
/** 近期记录概览：返回条数上限 */
const RECENT_LIMIT = 100;

let db: Database.Database | null = null;

/** 注入 DAO 使用的数据库连接（通常在主进程启动初始化时调用一次）。 */
export function setProfileDatabase(database: Database.Database): void {
  db = database;
}

/** profiles 表单行结构（id 恒为 1） */
interface ProfileRow {
  document: string;
  updated_at: string;
}

/** 本批喂入汇总的待汇总摘要，profileDao 导出共享，profiler 消费 */
export interface PendingSummary {
  recordId: number;
  summary: string;
  grade: string | null;
  tags: string[];
  createdAt: string;
}

/** analyses JOIN records 后的待汇总行结构 */
interface PendingSummaryRow {
  record_id: number;
  summary: string;
  grade: string | null;
  tags: string | null;
  created_at: string;
}

/** 近期记录概览条目（含摘要全文，供 profiler 历史时间线参考），profileDao 导出共享 */
export interface RecentMention {
  recordId: number;
  createdAt: string;
  grade: string | null;
  tags: string[];
  summary: string;
  analyzed: boolean;
}

/** analyses JOIN records 后的近期概览行结构 */
interface RecentMentionRow {
  record_id: number;
  created_at: string;
  grade: string | null;
  tags: string | null;
  summary: string;
  analyzed: number;
}

/**
 * records.tags JSON 快照列解析兜底：坏 JSON / 非数组按空数组处理。
 *
 * DAO 间不互相依赖，此处自写私有实现，不 import captureDao。
 */
function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

/**
 * 读取当前用户画像（profiles 表单行）。
 *
 * 无行返回 null；document 为 ProfileDocument JSON 文本，JSON.parse 失败按
 * null 处理（坏数据降级不抛，视为尚无画像）。
 *
 * @returns 画像文档与上次汇总时间；不存在或数据损坏时 null
 */
export function getProfile(): { document: ProfileDocument; updatedAt: string } | null {
  if (!db) {
    throw new Error('profileDao: database not initialized: call setProfileDatabase first');
  }

  const row = db
    .prepare(`SELECT document, updated_at FROM profiles WHERE id = 1`)
    .get() as unknown as ProfileRow | undefined;

  if (!row) {
    return null;
  }

  try {
    return { document: JSON.parse(row.document) as ProfileDocument, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/**
 * 全量重写画像、追加历史快照并对本批输入摘要打汇总时间戳，单事务保证一致。
 *
 * profiles 行 UPSERT（id = 1，document 为 JSON.stringify(input.document)，
 * updated_at 为当前 ISO 字符串）；profile_history 追加一行快照（document、
 * created_at 与 profiles 行同刻）；input.stampedIds 非空时批量
 * UPDATE analyses SET profiled_at = now WHERE record_id IN (...)，
 * now 与画像 updated_at 为同一时刻（同一变量）。
 *
 * @param input 画像文档 + 本次喂入汇总的 analyses.record_id 列表（可空数组）
 */
export function saveProfileWithStamp(input: {
  document: ProfileDocument;
  stampedIds: number[];
}): void {
  const database = db;
  if (!database) {
    throw new Error('profileDao: database not initialized: call setProfileDatabase first');
  }

  const now = new Date().toISOString();
  const documentJson = JSON.stringify(input.document);

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO profiles (id, document, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`,
      )
      .run(documentJson, now);

    database
      .prepare(`INSERT INTO profile_history (document, created_at) VALUES (?, ?)`)
      .run(documentJson, now);

    if (input.stampedIds.length > 0) {
      const placeholders = input.stampedIds.map(() => '?').join(', ');
      database
        .prepare(`UPDATE analyses SET profiled_at = ? WHERE record_id IN (${placeholders})`)
        .run(now, ...input.stampedIds);
    }
  })();
}

/**
 * 读取画像历史快照列表（profile_history 全量，id 倒序 = 最新在前）。
 *
 * document 逐行 JSON.parse，坏 JSON 降级为空对象 {}（条目仍列出、时间不丢，
 * 仅内容不可读），不抛错。
 *
 * @returns 历史快照列表（最新在前）
 */
export function listProfileHistory(): ProfileHistoryEntry[] {
  if (!db) {
    throw new Error('profileDao: database not initialized: call setProfileDatabase first');
  }

  interface HistoryRow {
    id: number;
    document: string;
    created_at: string;
  }

  const rows = db
    .prepare(`SELECT id, document, created_at FROM profile_history ORDER BY id DESC`)
    .all() as unknown as HistoryRow[];

  return rows.map((row) => {
    let document: ProfileDocument = {};
    try {
      document = JSON.parse(row.document) as ProfileDocument;
    } catch {
      // 坏 JSON 降级空文档，条目保留
    }
    return { id: row.id, createdAt: row.created_at, document };
  });
}

/**
 * 读取待汇总队列（analyses.profiled_at IS NULL）。
 *
 * FIFO 双键排序：records.created_at ASC，同刻按 analyses.record_id ASC 兜底，
 * 保证批次顺序稳定。tags 取 records 表 tags JSON 快照列，经私有 parseTags 解析
 * （坏 JSON 降级空数组）。
 *
 * @returns 本批喂入汇总的待汇总摘要列表
 */
export function pendingSummaries(): PendingSummary[] {
  if (!db) {
    throw new Error('profileDao: database not initialized: call setProfileDatabase first');
  }

  const rows = db
    .prepare(
      `SELECT analyses.record_id, analyses.summary, analyses.grade, records.tags, records.created_at
       FROM analyses
       JOIN records ON records.id = analyses.record_id
       WHERE analyses.profiled_at IS NULL
       ORDER BY records.created_at ASC, analyses.record_id ASC`,
    )
    .all() as unknown as PendingSummaryRow[];

  return rows.map((row) => ({
    recordId: row.record_id,
    summary: row.summary,
    grade: row.grade,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
  }));
}

/**
 * 读取近期记录概览（含每条摘要全文）。
 *
 * 窗口语义：普通记录覆盖近 RECENT_BASE_WINDOW_DAYS 天；grade = 'high' 的
 * 记录放宽到近 RECENT_HIGH_WINDOW_DAYS 天（两条 OR 条件取并集）。窗口起点
 * 为当前 ISO 时间往前推对应天数，created_at 存 ISO 字符串，直接字符串比较。
 * 按 records.created_at DESC 倒序（最新在前），至多 RECENT_LIMIT 条。
 *
 * summary 为 analyses.summary 摘要全文（与 batch 同构）；analyzed =
 * (analyses.profiled_at IS NOT NULL)：该条摘要曾作为输入参与某次汇总，
 * 保留供调用方筛选，不渲染进喂模型的文本。tags 经私有 parseTags 解析
 * （坏 JSON 降级空数组）。
 *
 * @returns 近期概览列表（按时间倒序，至多 100 条）
 */
export function recentMentions(): RecentMention[] {
  if (!db) {
    throw new Error('profileDao: database not initialized: call setProfileDatabase first');
  }

  const now = Date.now();
  const baseWindowStart = new Date(
    now - RECENT_BASE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const highWindowStart = new Date(
    now - RECENT_HIGH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = db
    .prepare(
      `SELECT analyses.record_id, records.created_at, analyses.grade, records.tags,
              analyses.summary, (analyses.profiled_at IS NOT NULL) AS analyzed
       FROM analyses
       JOIN records ON records.id = analyses.record_id
       WHERE records.created_at >= ? OR (analyses.grade = 'high' AND records.created_at >= ?)
       ORDER BY records.created_at DESC
       LIMIT ?`,
    )
    .all(baseWindowStart, highWindowStart, RECENT_LIMIT) as unknown as RecentMentionRow[];

  return rows.map((row) => ({
    recordId: row.record_id,
    createdAt: row.created_at,
    grade: row.grade,
    tags: parseTags(row.tags),
    summary: row.summary,
    analyzed: row.analyzed === 1,
  }));
}

/**
 * 待汇总队列条数（analyses.profiled_at IS NULL）。
 *
 * @returns 未纳入画像汇总的摘要条数
 */
export function pendingCount(): number {
  if (!db) {
    throw new Error('profileDao: database not initialized: call setProfileDatabase first');
  }

  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM analyses WHERE profiled_at IS NULL`)
    .get() as unknown as { n: number };
  return row.n;
}

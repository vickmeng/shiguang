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
  document: string | null;
  tags: string;
  created_at: string;
  /** LEFT JOIN attachments 得到的相对路径，无附件行时为 null */
  image_path: string | null;
}

/** attachments 表行结构（图片记录的附件元数据） */
interface AttachmentRow {
  id: number;
  record_id: number;
  file_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
}

/**
 * 解析 records.tags JSON 列为标签名数组。
 *
 * 损坏 JSON 或非数组降级为 []，数组内非字符串元素被过滤。
 */
function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 将单条 JOIN 行转为 CaptureRecord。
 *
 * 单行场景（createCapture 的 RETURNING）下 imagePaths 至多含一个
 * 元素；多条 JOIN 行的聚合见 toRecords。
 */
function toRecord(row: RecordRow): CaptureRecord {
  return {
    id: row.id,
    text: row.text,
    sourceApp: row.source_app,
    document: row.document,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
    imagePaths: row.image_path === null ? [] : [row.image_path],
  };
}

/**
 * 将 LEFT JOIN 展开的多行按 record_id 聚合为 CaptureRecord[]。
 *
 * JOIN 行序保证为 records.created_at DESC, records.id DESC（记录序）+
 * attachments.id ASC（行自身升序），故同一记录的多行附件连续出现且按插入序排列，
 * 顺序 push 即得有序 imagePaths；无附件记录只有一行且 image_path 为 null。
 */
function toRecords(rows: RecordRow[]): CaptureRecord[] {
  const records: CaptureRecord[] = [];
  let current: CaptureRecord | null = null;
  for (const row of rows) {
    if (current === null || current.id !== row.id) {
      current = toRecord(row);
      records.push(current);
    } else if (row.image_path !== null) {
      current.imagePaths.push(row.image_path);
    }
  }
  return records;
}

/**
 * 写入一条纯文字捕获记录，返回已入库的 CaptureRecord。
 *
 * @param input 记录内容（document 为 Lexical EditorState JSON，缺省为 null；
 *   sourceApp 缺省为 null；tags 缺省 = 不打标，入库 '[]'）
 * @returns 已入库的记录（含数据库生成的 id/createdAt，imagePaths 恒为 []）
 */
export function createCapture(
  input: { text: string; document?: string | null; sourceApp?: string | null; tags?: string[] },
): CaptureRecord {
  if (!db) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  const row = db
    .prepare(
      `INSERT INTO records (text, document, source_app, tags, created_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       RETURNING *, NULL AS image_path`,
    )
    .get(
      input.text,
      input.document ?? null,
      input.sourceApp ?? null,
      JSON.stringify(input.tags ?? []),
    ) as unknown as RecordRow;

  return toRecord(row);
}

/**
 * 写入一条图文整包捕获记录（records 行 + N 行 attachments），返回已入库的 CaptureRecord。
 *
 * 单事务内先写 records 行（text/document/source_app，document 为 Lexical EditorState
 * JSON，缺省为 null），再按 input.attachments 数组顺序逐行写 attachments
 * （record_id 关联、file_path 为相对 userData 的路径、sizeBytes 缺省为 null）；
 * 任一步失败整体回滚，保证两表一致。
 *
 * @param input 记录内容（document/sourceApp 缺省为 null；tags 缺省 = 不打标；
 *   attachments 无图时传 []）
 * @returns 已入库的记录（imagePaths 由 input.attachments 的 filePath 顺序组装）
 */
export function createCaptureWithAttachments(input: {
  text: string;
  document?: string | null;
  sourceApp?: string | null;
  tags?: string[];
  attachments: Array<{ filePath: string; sizeBytes?: number }>;
}): CaptureRecord {
  const database = db;
  if (!database) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  return database.transaction(() => {
    const row = database
      .prepare(
        `INSERT INTO records (text, document, source_app, tags, created_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         RETURNING *`,
      )
      .get(
        input.text,
        input.document ?? null,
        input.sourceApp ?? null,
        JSON.stringify(input.tags ?? []),
      ) as unknown as Omit<RecordRow, 'image_path'>;

    const insertAttachment = database.prepare(
      `INSERT INTO attachments (record_id, file_path, size_bytes, created_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    );
    for (const attachment of input.attachments) {
      insertAttachment.run(row.id, attachment.filePath, attachment.sizeBytes ?? null);
    }

    const record = toRecord({ ...row, image_path: null });
    record.tags = input.tags ?? [];
    record.imagePaths = input.attachments.map((attachment) => attachment.filePath);
    return record;
  })();
}

/**
 * 按时间倒序返回捕获记录。
 *
 * ORDER BY records.created_at DESC, records.id DESC：created_at 为毫秒级时间戳，
 * 同毫秒并发写入时以自增 id 兜底保证顺序确定；附件行按 attachments.id ASC 组装
 * 为有序 imagePaths。不传 limit 时返回全部记录。
 *
 * @param limit 最多返回的条数（取最新 N 条），缺省返回全部
 */
export function listCaptures(limit?: number): CaptureRecord[] {
  if (!db) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }

  const selectRecords =
    limit === undefined
      ? db.prepare(
          `SELECT records.*, attachments.file_path AS image_path
           FROM records
           LEFT JOIN attachments ON attachments.record_id = records.id
           ORDER BY records.created_at DESC, records.id DESC, attachments.id ASC`,
        )
      : db.prepare(
          `SELECT records.*, attachments.file_path AS image_path
           FROM records
           LEFT JOIN attachments ON attachments.record_id = records.id
           ORDER BY records.created_at DESC, records.id DESC, attachments.id ASC LIMIT ?`,
        );

  const rows = (
    limit === undefined ? selectRecords.all() : selectRecords.all(limit)
  ) as unknown as RecordRow[];

  return toRecords(rows);
}

/**
 * 分页筛选查询捕获记录，返回当页数据与同条件全量条数。
 *
 * 排序固定 records.created_at DESC, records.id DESC（同毫秒并发写入时以自增 id
 * 兜底保证顺序确定）；keyword 走参数化 LIKE 包含匹配，since 走 created_at >= ?，
 * until 走 created_at <= ?（含该秒），hasImages 走 EXISTS / NOT EXISTS
 *（true=仅含图，false=仅无图，缺省=全部），四者可任意组合（created_at 为 ISO
 * 字符串，字典序即时间序），均按是否传入动态拼接 WHERE。total 与 items 共用同一
 * 组条件，保证分页页数计算与当页数据一致。items 经 LEFT JOIN attachments 返回，
 * 在 JS 侧按 record_id 聚合为有序 imagePaths。
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
    conditions.push(`records.text LIKE '%' || ? || '%'`);
    params.push(input.keyword);
  }
  if (input.since !== undefined) {
    conditions.push(`records.created_at >= ?`);
    params.push(input.since);
  }
  if (input.until !== undefined) {
    conditions.push(`records.created_at <= ?`);
    params.push(input.until);
  }
  if (input.hasImages === true) {
    conditions.push(
      `EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id)`,
    );
  }
  if (input.hasImages === false) {
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id)`,
    );
  }
  if (input.tagNames !== undefined && input.tagNames.length > 0) {
    // tags 列为标签名 JSON 数组快照，参数带引号 LIKE 精确到数组元素，避免
    // 'AI' 误命中快照 ["AIGC"]；多值任一命中（OR）
    const quoted = input.tagNames.map((n) => '"' + n + '"');
    conditions.push(
      '(' + quoted.map(() => `records.tags LIKE '%' || ? || '%'`).join(' OR ') + ')',
    );
    params.push(...quoted);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM records${where}`)
      .get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `SELECT records.*, attachments.file_path AS image_path
       FROM records
       LEFT JOIN attachments ON attachments.record_id = records.id
       ${where} ORDER BY records.created_at DESC, records.id DESC, attachments.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize) as unknown as RecordRow[];

  return { items: toRecords(rows), total };
}

/**
 * 单事务批量删除捕获记录。
 *
 * 级联删 attachments，返回待清理的相对文件路径列表，磁盘清理由调用方负责。
 *
 * @param ids 待删除的记录 id 集合；不存在的 id 静默跳过，空数组时不执行删除、不抛错
 * @returns 被删图片记录的附件相对路径列表（文字记录无附件不产生路径）
 */
export function deleteCaptures(ids: number[]): string[] {
  const database = db;
  if (!database) {
    throw new Error('capture database not initialized: call setCaptureDatabase first');
  }
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  return database.transaction(() => {
    const rows = database
      .prepare(`SELECT file_path FROM attachments WHERE record_id IN (${placeholders})`)
      .all(...ids) as unknown as Array<{ file_path: string }>;
    const filePaths = rows.map((row) => row.file_path);

    database
      .prepare(`DELETE FROM attachments WHERE record_id IN (${placeholders})`)
      .run(...ids);
    database.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...ids);

    return filePaths;
  })();
}

/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0002_attachment —— records 增加 type 列（文字/图片），并新建 attachments 表（M4 选区截图）。
 *
 * 说明：
 * - records.type：TEXT NOT NULL DEFAULT 'text'，列级 CHECK 限定 'text'/'image'；
 *   SQLite 支持 ALTER TABLE ADD COLUMN 携带列级 CHECK，旧行自动回填默认值 'text'。
 * - attachments：图片附件表，record_id 外键关联 records(id)，file_path 为相对
 *   userData 的路径（如 images/<uuid>.png），mime_type 缺省 'image/png'。
 */

const UP_SQL = `
ALTER TABLE records ADD COLUMN type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','image'));

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const DOWN_SQL = `
DROP TABLE IF EXISTS attachments;

-- SQLite 不支持 DROP COLUMN（3.35+ 虽支持但会破坏 CHECK 重建语义），
-- 以"建新表 → 拷数据 → 删旧表 → 改名"重建无 type 列的 records 表。
CREATE TABLE records_no_type (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source_app TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO records_no_type (id, text, source_app, created_at)
  SELECT id, text, source_app, created_at FROM records;
DROP TABLE records;
ALTER TABLE records_no_type RENAME TO records;

CREATE INDEX IF NOT EXISTS idx_records_created_at ON records (created_at DESC);
`;

export const migration = {
  name: '0002_attachment',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

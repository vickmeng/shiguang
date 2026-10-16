/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0001_init —— records 单表建表迁移（M1 范围裁剪：仅纯文字记录，无 attachments 表）。
 *
 * 说明：
 * - records 为纯文字捕获记录；图片需求由 M4 选区截图承接，届时以新迁移扩展。
 * - 索引：records(created_at DESC) 支撑 listCaptures 按时间倒序查询。
 */

const DDL = `
CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source_app TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_records_created_at ON records (created_at DESC);
`;

export const migration = {
  name: '0001_init',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DDL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(`DROP TABLE IF EXISTS records;`);
  },
};

export default migration;

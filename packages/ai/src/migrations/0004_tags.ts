/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0004_tags —— 新增 tags 表，records 增 tags 列（标签名快照 JSON 数组）。
 *
 * 说明：
 * - tags 表为标签库：name 全局唯一（UNIQUE），color 创建时从预置色板随机取值，
 *   created_at 默认当前 UTC 时间。
 * - records.tags：TEXT NOT NULL DEFAULT '[]'，存标签名快照 JSON 数组；标签删除/
 *   重命名不回溯历史记录快照（已删标签展示为灰色由读侧按库内缺失判定）。
 * - down 先删 records.tags 列，再删 tags 表。
 */

const UP_SQL = `
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE records ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
`;

const DOWN_SQL = `
ALTER TABLE records DROP COLUMN tags;

DROP TABLE IF EXISTS tags;
`;

export const migration = {
  name: '0004_tags',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

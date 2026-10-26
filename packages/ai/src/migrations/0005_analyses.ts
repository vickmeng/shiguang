/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0005_analyses —— 新增 analyses 表（AI 一句话摘要，与 records 1:1）。
 *
 * 说明：
 * - record_id 直接作主键并引用 records(id) ON DELETE CASCADE：删记录摘要
 *   随 FK 级联删除（PRAGMA foreign_keys = ON，沿用 attachments 模式），无孤儿数据。
 * - summary / model 均 NOT NULL：摘要永远与记录同事务入库，model 记实际调用模型
 *   便于事后追溯；created_at 与 records 同口径（UTC ISO 默认）。
 * - 1:1 关系由 record_id PK 天然保证，无需 UNIQUE 重复声明。
 * - down 为标准 DROP TABLE（失败即不入库，无 status/prompt_version 预埋）。
 */

const UP_SQL = `
CREATE TABLE analyses (record_id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE, summary TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
`;

const DOWN_SQL = `
DROP TABLE IF EXISTS analyses;
`;

export const migration = {
  name: '0005_analyses',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

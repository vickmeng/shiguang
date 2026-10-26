/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0006_analyses_grade —— analyses 表新增可空 grade 列（AI 摘要三档分级）。
 *
 * 说明：
 * - grade TEXT 可空、无默认值、无 CHECK：分级合法性写入前由应用层 zod enum
 *   保证（与既有迁移风格一致），NULL 表示 AI 未返回分级或旧数据。
 * - down 直接用 ALTER TABLE ... DROP COLUMN（better-sqlite3 ^12.11.1 内置
 *   SQLite ≥3.35 支持），无需重建表。
 */

const UP_SQL = `
ALTER TABLE analyses ADD COLUMN grade TEXT;
`;

const DOWN_SQL = `
ALTER TABLE analyses DROP COLUMN grade;
`;

export const migration = {
  name: '0006_analyses_grade',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

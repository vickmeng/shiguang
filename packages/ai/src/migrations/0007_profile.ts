/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0007_profile —— analyses 表新增可空 profiled_at 列 + 新建 profiles 单例画像表。
 *
 * 说明：
 * - profiled_at TEXT 可空、无默认值、无 CHECK：语义 = 曾作为输入参与过某次
 *   画像汇总的时间戳，NULL 表示尚未纳入（风格同 0006 grade 列）。
 * - profiles 为单例表：id INTEGER PRIMARY KEY CHECK (id = 1) 强制全局仅一行，
 *   document 为 ProfileDocument JSON 文本，updated_at 为上次汇总成功时刻。
 * - down 直接用 ALTER TABLE ... DROP COLUMN（better-sqlite3 ^12.11.1 内置
 *   SQLite ≥3.35 支持），无需重建表。
 */

const UP_SQL = `
ALTER TABLE analyses ADD COLUMN profiled_at TEXT;
CREATE TABLE profiles (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

const DOWN_SQL = `
DROP TABLE profiles;
ALTER TABLE analyses DROP COLUMN profiled_at;
`;

export const migration = {
  name: '0007_profile',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

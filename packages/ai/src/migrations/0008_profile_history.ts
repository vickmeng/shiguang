/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0008_profile_history —— 新建 profile_history 画像历史表 + 清空 profiles 单例行。
 *
 * 说明：
 * - profile_history 为追加式快照表：每次画像汇总成功追加一行
 *   （由 profileDao.saveProfileWithStamp 在同一事务写入），document 为
 *   ProfileDocument JSON 文本，created_at 为该次汇总成功时刻（与 profiles
 *   行 updated_at 同刻）。id AUTOINCREMENT 单调递增即版本序，留作日后
 *   人格变化分析的数据基础。
 * - DELETE FROM profiles：按产品决策不补录既有画像为历史 v1，直接清空
 *   当前画像，历史从本迁移后的第一次成功汇总开始记录。
 * - down 仅 DROP TABLE profile_history；profiles 行已在 up 中删除且无可
 *   回滚备份（数据为 AI 生成、可重新汇总恢复），down 不回填。
 */

const UP_SQL = `
CREATE TABLE profile_history (id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL, created_at TEXT NOT NULL);
DELETE FROM profiles;
`;

const DOWN_SQL = `
DROP TABLE profile_history;
`;

export const migration = {
  name: '0008_profile_history',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

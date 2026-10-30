import Database from 'better-sqlite3';
import type { RunnableMigration, UmzugStorage } from 'umzug';
import { migration as initMigration } from './migrations/0001_init';
import { migration as attachmentMigration } from './migrations/0002_attachment';
import { migration as dropTypeMigration } from './migrations/0003_drop_type';
import { migration as tagsMigration } from './migrations/0004_tags';
import { migration as analysesMigration } from './migrations/0005_analyses';
import { migration as analysesGradeMigration } from './migrations/0006_analyses_grade';
import { migration as profileMigration } from './migrations/0007_profile';
import { migration as profileHistoryMigration } from './migrations/0008_profile_history';

/**
 * 已执行迁移记录表（design.md 3.2 节：storage 自定义为 SQLite 表记录已执行迁移，
 * 表名 _migrations）。与业务数据同文件，维持"单一 SQLite 文件"诉求。
 */
const MIGRATIONS_TABLE = '_migrations';

/**
 * umzug storage 契约（UmzugStorage）的 better-sqlite3 实现。
 * umzug@3.8 未内置 SQLiteStorage，故按 design 3.2 节自定义。
 */
class SqliteMigrationStorage implements UmzugStorage<Database.Database> {
  private readonly insertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly selectStmt: Database.Statement;

  constructor(db: Database.Database) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (name TEXT PRIMARY KEY)`,
    );
    this.insertStmt = db.prepare(
      `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`,
    );
    this.deleteStmt = db.prepare(
      `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`,
    );
    this.selectStmt = db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  }

  /** 已执行迁移名列表（同步实现，供 initDatabase 的同步驱动使用）。 */
  executedSync(): string[] {
    return this.selectStmt.all().map((row) => (row as { name: string }).name);
  }

  logMigrationSync(name: string): void {
    this.insertStmt.run(name);
  }

  async logMigration({ name }: { name: string }): Promise<void> {
    this.logMigrationSync(name);
  }

  async unlogMigration({ name }: { name: string }): Promise<void> {
    this.deleteStmt.run(name);
  }

  async executed(): Promise<string[]> {
    return this.executedSync();
  }
}

/**
 * migrations/ 目录下的全部迁移（umzug RunnableMigration 形态，按序执行）。
 * 新增迁移文件时在此登记。
 */
const migrations: RunnableMigration<Database.Database>[] = [
  initMigration,
  attachmentMigration,
  dropTypeMigration,
  tagsMigration,
  analysesMigration,
  analysesGradeMigration,
  profileMigration,
  profileHistoryMigration,
];

/**
 * 初始化数据库：打开 better-sqlite3 → PRAGMA foreign_keys = ON → 执行全部待运行迁移。
 *
 * 说明：initDatabase 契约为同步返回 Database，而 umzug 的编排 API（up()/down()）
 * 为异步（Promise 无法在主线程同步等待）。由于所有迁移体均为同步 DDL exec，
 * 这里以同步方式驱动 pending 迁移（语义与 umzug.up() 等价：先查 storage 中已执行
 * 记录，跳过已执行者，执行后立即记录），保证函数返回时迁移一定已应用。
 *
 * @param dbPath SQLite 文件路径
 * @returns 迁移已就绪的数据库连接
 */
export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const storage = new SqliteMigrationStorage(db);
  const executed = new Set(storage.executedSync());

  for (const migration of migrations) {
    if (executed.has(migration.name)) continue;
    // 迁移体无内部 await，调用即同步完成 DDL 执行
    void migration.up({ name: migration.name, path: '', context: db });
    storage.logMigrationSync(migration.name);
  }

  return db;
}

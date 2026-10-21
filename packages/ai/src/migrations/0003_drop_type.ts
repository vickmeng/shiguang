/** 迁移执行上下文：better-sqlite3 Database（这里只用到 exec，故用结构化类型，
 * 避免依赖 @types/better-sqlite3；db.ts 会以完整 Database 类型注入）。 */
interface MigrationContext {
  exec(sql: string): unknown;
}

/**
 * 0003_drop_type —— records 删 type 列、增 document 列（Lexical EditorState JSON）。
 *
 * 说明（2026-10-20 修订）：
 * - records.type 由 0002 引入，用于区分文字/图片记录；M4 改为 attachments 表存在性
 *   判定含图（DAO 侧 EXISTS 子查询），type 列退役。
 * - records.document：Lexical EditorState JSON，可空，为记录编辑功能预埋，
 *   本期读侧不消费。
 * - down 先删 document 列，再恢复 type 列（TEXT NOT NULL DEFAULT 'text'），
 *   并按 attachments 关联回填 'image'/'text'。
 */

const UP_SQL = `
ALTER TABLE records DROP COLUMN type;

ALTER TABLE records ADD COLUMN document TEXT;
`;

const DOWN_SQL = `
ALTER TABLE records DROP COLUMN document;

ALTER TABLE records ADD COLUMN type TEXT NOT NULL DEFAULT 'text';

UPDATE records SET type='image' WHERE EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id);

UPDATE records SET type='text' WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id);
`;

export const migration = {
  name: '0003_drop_type',
  up: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(UP_SQL);
  },
  down: async ({ context: db }: { context: MigrationContext }) => {
    db.exec(DOWN_SQL);
  },
};

export default migration;

import type Database from 'better-sqlite3';
import { TAG_COLOR_PALETTE, TAG_NAME_MAX_LENGTH, type Tag } from '@shiguang/shared';

/**
 * tagDao 持有的数据库连接。
 *
 * DAO 函数契约为 (input) 形态（不含 db 参数），故连接以模块级单例方式注入：
 * 主进程启动时调用一次 setTagDatabase(initDatabase(dbPath))，之后 DAO 函数直接使用。
 */
let db: Database.Database | null = null;

/** 注入 DAO 使用的数据库连接（通常在主进程启动初始化时调用一次）。 */
export function setTagDatabase(database: Database.Database): void {
  db = database;
}

/** tags 表行结构 */
interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

/** 行字段 snake→camel 映射为 Tag。 */
function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color };
}

/** 标签名校验：trim 后需为 1~TAG_NAME_MAX_LENGTH 字，违规抛错。 */
function assertValidName(name: string): void {
  if (name.length === 0 || name.length > TAG_NAME_MAX_LENGTH) {
    throw new Error('标签名需为 1~20 字');
  }
}

/**
 * 按 id 升序返回标签库全部条目。
 */
export function listTags(): Tag[] {
  if (!db) {
    throw new Error('tag database not initialized: call setTagDatabase first');
  }

  const rows = db.prepare(`SELECT * FROM tags ORDER BY id ASC`).all() as unknown as TagRow[];
  return rows.map(toTag);
}

/**
 * 新建标签，返回已入库的 Tag。
 *
 * 名称先 trim，空或超过 TAG_NAME_MAX_LENGTH 抛 Error('标签名需为 1~20 字')；
 * 重名时直接返回库内已有条目（重名转选中语义，不产生新行）；未命中时
 * INSERT 新行，color 从 TAG_COLOR_PALETTE 随机取值。
 *
 * @param input 标签名（允许首尾空白，落库前 trim）
 * @returns 已入库的 Tag（重名时为已有条目）
 */
export function createTag(input: { name: string }): Tag {
  if (!db) {
    throw new Error('tag database not initialized: call setTagDatabase first');
  }

  const name = input.name.trim();
  assertValidName(name);

  const existing = db.prepare(`SELECT * FROM tags WHERE name = ?`).get(name) as
    | TagRow
    | undefined;
  if (existing !== undefined) {
    return toTag(existing);
  }

  const color = TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)];
  const row = db.prepare(`INSERT INTO tags (name, color) VALUES (?, ?)`).run(name, color);

  return toTag({
    id: Number(row.lastInsertRowid),
    name,
    color,
    created_at: '',
  });
}

/**
 * 重命名标签，返回更新后的 Tag。
 *
 * 名称先 trim，空或超过 TAG_NAME_MAX_LENGTH 抛 Error('标签名需为 1~20 字')；
 * UPDATE 后查无该行抛 Error('标签不存在')。
 *
 * @param input 目标标签 id 与新名称（允许首尾空白，落库前 trim）
 * @returns 更新后的 Tag（id/color 不变）
 */
export function renameTag(input: { id: number; name: string }): Tag {
  if (!db) {
    throw new Error('tag database not initialized: call setTagDatabase first');
  }

  const name = input.name.trim();
  assertValidName(name);

  db.prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(name, input.id);

  const row = db.prepare(`SELECT * FROM tags WHERE id = ?`).get(input.id) as TagRow | undefined;
  if (row === undefined) {
    throw new Error('标签不存在');
  }

  return toTag(row);
}

/**
 * 删除标签；不存在的 id 静默跳过。
 *
 * 不回溯 records 快照：已入库记录保留标签名文字，展示侧自行降级为灰色。
 *
 * @param input 目标标签 id
 */
export function deleteTag(input: { id: number }): void {
  if (!db) {
    throw new Error('tag database not initialized: call setTagDatabase first');
  }

  db.prepare(`DELETE FROM tags WHERE id = ?`).run(input.id);
}

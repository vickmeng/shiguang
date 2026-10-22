/**
 * 标签相关 IPC handler 注册（REQ-TAG-01~04 / AC-2、AC-3、AC-4）。
 *
 * 数据库连接由主进程启动时 `setTagDatabase(initDatabase(dbPath))` 注入
 * （见 main/index.ts），本模块直接使用 tagDao，不再关心连接来源。
 *
 * 六通道与底层一一对应、零编排：
 *  - tags:list     → listTags()
 *  - tags:create   → createTag(payload)（payload 原样透传；DAO 内含
 *                    trim / 1~20 字校验 / 重名转选中语义）
 *  - tags:rename   → renameTag(payload)（id/color 不变，不回溯记录快照）
 *  - tags:delete   → deleteTag(payload)（不存在静默跳过，resolve undefined）
 *  - tags:lastGet  → getLastTags()（userData/tags-last.json，损坏降级 []）
 *  - tags:lastSet  → setLastTags(payload.names)（取 .names 字段，
 *                    原子写记忆本次提交的标签组合）
 *
 * DAO 抛错（名称违规 / 标签不存在）即自然 reject invoke，渲染侧 catch 提示。
 */
import { ipcMain } from 'electron';
import { createTag, deleteTag, listTags, renameTag } from '@shiguang/ai';
import { IPC } from '@shiguang/shared';
import type {
  CreateTagPayload,
  DeleteTagPayload,
  RenameTagPayload,
  SetLastTagsPayload,
} from '@shiguang/shared';
import { getLastTags, setLastTags } from '../tags/tagMemoryStore';

/** 注册标签相关 IPC 通道：库维护四通道 + 标签组合记忆两通道。 */
export function registerTagsHandlers(): void {
  // 一律 async：DAO 抛错（名称违规 / 标签不存在）自然 reject invoke，
  // 渲染侧 catch 提示。
  ipcMain.handle(IPC.tagsList, async () => listTags());
  ipcMain.handle(IPC.tagsCreate, async (_event, payload: CreateTagPayload) =>
    createTag(payload),
  );
  ipcMain.handle(IPC.tagsRename, async (_event, payload: RenameTagPayload) =>
    renameTag(payload),
  );
  ipcMain.handle(IPC.tagsDelete, async (_event, payload: DeleteTagPayload) => {
    deleteTag(payload);
  });
  ipcMain.handle(IPC.tagsLastGet, async () => getLastTags());
  ipcMain.handle(IPC.tagsLastSet, async (_event, payload: SetLastTagsPayload) => {
    setLastTags(payload.names);
  });
}

/**
 * 捕获相关 IPC handler 注册。
 *
 * 数据库连接由主进程启动时 `setCaptureDatabase(initDatabase(dbPath))` 注入
 * （见 main/index.ts），本模块直接使用 captureDao，不再关心连接来源。
 */
import { ipcMain } from 'electron';
import { createCapture, queryCaptures, deleteCaptures } from '@shiguang/ai';
import { IPC } from '@shiguang/shared';
import type {
  CreateCapturePayload,
  QueryCapturesPayload,
  DeleteCapturesPayload,
} from '@shiguang/shared';

/** 注册捕获相关 IPC 通道：写入、分页查询、批量删除。 */
export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC.captureCreate, (_event, payload: CreateCapturePayload) =>
    createCapture({ text: payload.text, sourceApp: null }),
  );
  ipcMain.handle(IPC.captureList, (_event, payload: QueryCapturesPayload) =>
    queryCaptures(payload),
  );
  ipcMain.handle(IPC.captureDelete, (_event, payload: DeleteCapturesPayload) =>
    deleteCaptures(payload.ids),
  );
}

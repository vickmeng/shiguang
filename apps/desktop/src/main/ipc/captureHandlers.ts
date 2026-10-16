/**
 * 捕获相关 IPC handler 注册。
 *
 * 数据库连接由主进程启动时 `setCaptureDatabase(initDatabase(dbPath))` 注入
 * （见 main/index.ts），本模块直接使用 captureDao，不再关心连接来源。
 */
import { ipcMain } from 'electron';
import { createCapture } from '@shiguang/ai';
import { IPC } from '@shiguang/shared';
import type { CreateCapturePayload } from '@shiguang/shared';

/** 注册 `capture:create` 通道：写入一条纯文字捕获记录并返回入库结果。 */
export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC.captureCreate, (_event, payload: CreateCapturePayload) =>
    createCapture({ text: payload.text, sourceApp: null }),
  );
}

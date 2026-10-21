/**
 * 捕获相关 IPC handler 注册。
 *
 * 数据库连接由主进程启动时 `setCaptureDatabase(initDatabase(dbPath))` 注入
 * （见 main/index.ts），本模块直接使用 captureDao，不再关心连接来源。
 *
 * 写入链路（capture:create）：payload.images 为 { data, sizeBytes }[]
 * （字节经 structured clone 传入），先 map 提取 data 调 writeImageFiles
 * 落盘（任一张失败时已写文件回滚并抛错，见 screenshotService），返回的
 * written（{ filePath, sizeBytes }[]）原样作为 attachments 调
 * createCaptureWithAttachments 入库（sizeBytes 以 written 为准），
 * sourceApp 恒 null，payload.document（Lexical EditorState JSON，可空）
 * 原样转发入库、缺省归一 null（design.md 决策 16 双写入 records.document 列）；
 * 写盘抛错时 invoke 被拒绝，渲染侧 catch 提示。
 *
 * 复制链路（capture:copy-image）：按 id 经 queryCaptures 查记录 →
 * imagePaths.length === 0 抛 Error('该记录不是图片')（不存在 id 同样落入
 * 此分支；多图记录恒复制首图 imagePaths[0]）→
 * nativeImage.createFromPath(userData/imagePaths[0]) → isEmpty() 抛
 * Error('图片文件缺失或损坏') → 否则 clipboard.write([ClipboardItem])（Electron 44
 * 起剪贴板为 W3C 异步 API，旧 writeImage 已移除）。
 * handler 为 async，抛错即拒绝 invoke，渲染侧 catch 提示。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, ClipboardItem, ipcMain, nativeImage } from 'electron';
import {
  createCaptureWithAttachments,
  queryCaptures,
  deleteCaptures,
} from '@shiguang/ai';
import { writeImageFiles } from '../screenshot/screenshotService';
import { IPC } from '@shiguang/shared';
import type {
  CopyImagePayload,
  CreateCapturePayload,
  QueryCapturesPayload,
  DeleteCapturesPayload,
} from '@shiguang/shared';

/** 注册捕获相关 IPC 通道：写入、分页查询、批量删除。 */
export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC.captureCreate, async (_event, payload: CreateCapturePayload) => {
    const written = await writeImageFiles(payload.images.map((img) => img.data));
    return createCaptureWithAttachments({
      text: payload.text,
      // design.md 决策 16：Lexical EditorState JSON 双写入 records.document 列，
      // 渲染层 payload.document 可空，缺省归一为 null。
      document: payload.document ?? null,
      sourceApp: null,
      attachments: written,
    });
  });
  ipcMain.handle(IPC.captureList, (_event, payload: QueryCapturesPayload) =>
    queryCaptures(payload),
  );
  ipcMain.handle(IPC.captureDelete, (_event, payload: DeleteCapturesPayload) => {
    const imagePaths = deleteCaptures(payload.ids);
    // 磁盘尽力清理：删除失败的孤儿文件仅 console.warn 记日志（技术债务，
    // 随 M9 存储治理），不阻塞删除返回。
    for (const p of imagePaths) {
      try {
        fs.rmSync(path.join(app.getPath('userData'), p), { force: true });
      } catch (err) {
        console.warn(`[shiguang] 删除图片文件失败（孤儿文件）: ${p}`, err);
      }
    }
  });
  ipcMain.handle(IPC.captureCopyImage, async (_event, payload: CopyImagePayload) => {
    const { items } = queryCaptures({
      page: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
    });
    const rec = items.find((r) => r.id === payload.id);
    if (!rec || rec.imagePaths.length === 0) {
      throw new Error('该记录不是图片');
    }
    const image = nativeImage.createFromPath(
      path.join(app.getPath('userData'), rec.imagePaths[0]),
    );
    if (image.isEmpty()) {
      throw new Error('图片文件缺失或损坏');
    }
    // Electron 44 起剪贴板换成 W3C 异步 API：以 PNG Blob 写入
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())]) }),
    ]);
  });
}

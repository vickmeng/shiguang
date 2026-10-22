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
 * 双写入 records.document 列（design.md 决策 16）：非空时 walk 其 JSON，
 * 按出现顺序把 image 节点以 blob: 开头的 src 重写为 writeImageFiles
 * 返回的相对路径（渲染端可直接拼 shiguang-image:// 协议 URL），
 * JSON.stringify 后入库；image 节点数超出 written 长度时保持原值，
 * 缺省归一 null；
 * payload.tags（标签名快照）原样转发，缺省 undefined 由 DAO 侧归一入库 '[]'；
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

/**
 * 重写 Lexical EditorState JSON 中 image 节点的 blob: src。
 * 递归 walk root.children，按出现顺序把 src 以 blob: 开头的 image 节点
 * 替换为 paths[i++]（i 从 0 起）；paths 用尽后剩余 image 节点保持原值。
 * document 中 image 节点数与 payload.images 长度一致是渲染端契约，
 * 正常路径不做防御性报错。
 */
export function rewriteImageSrcs(documentJson: string, paths: string[]): string {
  let i = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const n = node as Record<string, unknown>;
    if (n.type === 'image' && typeof n.src === 'string' && n.src.startsWith('blob:')) {
      if (i < paths.length) n.src = paths[i++];
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  const parsed = JSON.parse(documentJson) as { root?: { children?: unknown[] } };
  if (Array.isArray(parsed.root?.children)) walk(parsed.root.children);
  return JSON.stringify(parsed);
}

/** 注册捕获相关 IPC 通道：写入、分页查询、批量删除。 */
export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC.captureCreate, async (_event, payload: CreateCapturePayload) => {
    const written = await writeImageFiles(payload.images.map((img) => img.data));
    const writtenPaths = written.map((w) => w.filePath);
    return createCaptureWithAttachments({
      text: payload.text,
      // design.md 决策 16：Lexical EditorState JSON 双写入 records.document 列。
      // 渲染层 payload.document 可空，缺省归一为 null；非空时把 image 节点的
      // blob: src 按序重写为 writeImageFiles 返回的相对路径，使入库 document 自包含。
      document:
        payload.document != null
          ? rewriteImageSrcs(payload.document, writtenPaths)
          : null,
      sourceApp: null,
      attachments: written,
      // 标签名快照原样透传，缺省 undefined 由 DAO 侧归一入库 '[]'
      tags: payload.tags,
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

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
 * AI 分析编排（ai-record-summary）：writeImageFiles 落盘成功后进入 try 块——
 * 依次 analyzeCapture（@shiguang/ai，Kimi 多模态门卫 + 一句话摘要，输入为
 * written 相对路径）；!analysis.meaningful 或 summary.trim() 为空时抛
 * AI_NOT_MEANINGFUL_MESSAGE（渲染层据此区分 toast 文案）；否则
 * createCaptureWithAttachments 携 analysis: { summary, model: resolveKimiModel() }
 * 同事务写 analyses 表。try 块内任一步抛错（AI 断网/超时/无意义判定）均逐个
 * fs.rm(force) 清理已写图片后原样 rethrow——未入库不留孤儿文件。
 *
 * 复制链路（capture:copy-image）：按 id 经 getById 精确查记录
 * （ai-record-summary 任务 8，偿还 .rail/docs/records-console/README.md
 * 技术债务第 3 条，不再扫全表 queryCaptures.find）→
 * imagePaths.length === 0 抛 Error('该记录不是图片')（getById 返回 null
 * 同样落入此分支；多图记录恒复制首图 imagePaths[0]）→
 * nativeImage.createFromPath(userData/imagePaths[0]) → isEmpty() 抛
 * Error('图片文件缺失或损坏') → 否则 clipboard.write([ClipboardItem])（Electron 44
 * 起剪贴板为 W3C 异步 API，旧 writeImage 已移除）。
 * handler 为 async，抛错即拒绝 invoke，渲染侧 catch 提示。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, ClipboardItem, ipcMain, nativeImage } from 'electron';
import {
  analyzeCapture,
  createCaptureWithAttachments,
  queryCaptures,
  deleteCaptures,
  getById,
  resolveKimiModel,
} from '@shiguang/ai';
import { writeImageFiles } from '../screenshot/screenshotService';
import { AI_NOT_MEANINGFUL_MESSAGE, IPC } from '@shiguang/shared';
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
    try {
      const analysis = await analyzeCapture({
        text: payload.text,
        images: written.map((w) => ({ filePath: w.filePath })),
      });
      if (!analysis.meaningful || !analysis.summary?.trim()) {
        throw new Error(AI_NOT_MEANINGFUL_MESSAGE);
      }
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
        analysis: { summary: analysis.summary, model: resolveKimiModel() },
      });
    } catch (err) {
      // 主进程日志留痕原始错误（渲染层 toast 只有固定/通用两档文案，无细节）；
      // 真机走查排查 AI 链路（key / 端点 / 超时）以此为第一现场。
      console.error('[capture:create] 分析失败，本条不入库：', err);
      // 分析失败/无意义判定：未入库，逐个清理已写图片（尽力清理，不掩盖原错误）
      for (const w of written) {
        await fs.promises
          .rm(path.join(app.getPath('userData'), w.filePath), { force: true })
          .catch(() => {});
      }
      throw err;
    }
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
    const rec = getById(payload.id);
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

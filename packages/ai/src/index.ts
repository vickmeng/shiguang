/**
 * @shiguang/ai 数据层公开 API barrel（package.json exports 指向本文件）。
 *
 * 主进程通过 `import { initDatabase, setCaptureDatabase, ... } from '@shiguang/ai'`
 * 使用数据层；后续 M5 分析流水线（LangGraph）也在此追加导出。
 */
export { initDatabase } from './db';
export {
  setCaptureDatabase,
  createCapture,
  createCaptureWithAttachments,
  listCaptures,
  queryCaptures,
  deleteCaptures,
} from './dao/captureDao';
export type { CaptureRecord } from '@shiguang/shared';

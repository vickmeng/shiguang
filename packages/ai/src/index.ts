/**
 * @shiguang/ai 数据层 + Mastra 分析模块公开 API barrel（package.json exports 指向本文件）。
 *
 * 主进程通过 `import { initDatabase, setCaptureDatabase, ... } from '@shiguang/ai'`
 * 使用数据层与 capture:create 链路的 AI 分析（analyzeCapture：Kimi 多模态
 * 单步 Agent，门卫判定 + 一句话摘要）。
 */
export { initDatabase } from './db';
export {
  setCaptureDatabase,
  createCapture,
  createCaptureWithAttachments,
  listCaptures,
  queryCaptures,
  deleteCaptures,
  getById,
} from './dao/captureDao';
export {
  analyzeCapture,
  resolveKimiModel,
  setAnalysisImagesBaseDir,
} from './analysis/summarizer';
export { setTagDatabase, listTags, createTag, renameTag, deleteTag } from './dao/tagDao';
export type { CaptureRecord } from '@shiguang/shared';

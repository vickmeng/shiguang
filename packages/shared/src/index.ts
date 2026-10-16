/**
 * 共享类型（M1 范围裁剪：仅支持纯文字捕获）。
 *
 * 图片机制由 M4 选区截图承接，届时再重建；M1 的捕获记录为纯文字形态。
 */
export interface CaptureRecord {
  id: number;
  text: string;
  sourceApp: string | null;
  createdAt: string;
}

/** 主进程与渲染进程之间的 IPC 通道常量 */
export const IPC = {
  captureCreate: 'capture:create',
  petSetState: 'pet:set-state',
  inputBlur: 'input:blur',
  inputClose: 'input:close',
  petClicked: 'pet:clicked',
} as const;

/** 创建捕获记录的载荷（M1 仅纯文字） */
export interface CreateCapturePayload {
  text: string;
}

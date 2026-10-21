/**
 * 共享类型。
 *
 * M4 起捕获记录支持图文整包：记录可携带文字与多张图片，图片关联
 * attachments 相对路径（相对 userData 根）。
 */
export interface CaptureRecord {
  id: number;
  text: string;
  sourceApp: string | null;
  createdAt: string;
  /** attachments 相对路径数组，JS 侧按 record_id 聚合；无图记录恒为 [] */
  imagePaths: string[];
}

/** 主进程与渲染进程之间的 IPC 通道常量 */
export const IPC = {
  captureCreate: 'capture:create',
  captureList: 'capture:list',
  captureDelete: 'capture:delete',
  consoleOpen: 'console:open',
  petSetState: 'pet:set-state',
  inputBlur: 'input:blur',
  inputClose: 'input:close',
  petClicked: 'pet:clicked',
  /** invoke：复制图片记录到剪贴板 */
  captureCopyImage: 'capture:copy-image',
} as const;

/**
 * 图文整包：文字可选 + 图片不限张数，字节 structured clone；
 * document 为 Lexical EditorState JSON，完整版式入库存档、为编辑功能预埋。
 */
export interface CreateCapturePayload {
  text: string;
  document?: string | null;
  images: { data: Uint8Array; sizeBytes: number }[];
}

/** 查询捕获记录的分页筛选载荷 */
export interface QueryCapturesPayload {
  keyword?: string;
  since?: string;
  /** ISO 8601 结束时间（含该秒），缺省不过滤 */
  until?: string;
  /** true=仅含图，false=仅无图，缺省=全部 */
  hasImages?: boolean;
  page: number;
  pageSize: number;
}

/** 查询捕获记录的分页结果 */
export interface QueryCapturesResult {
  items: CaptureRecord[];
  total: number;
}

/** 批量删除捕获记录的载荷 */
export interface DeleteCapturesPayload {
  ids: number[];
}

/** 复制图片记录载荷 */
export interface CopyImagePayload {
  id: number;
}

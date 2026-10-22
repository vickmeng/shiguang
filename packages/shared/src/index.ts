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
  /**
   * Lexical EditorState JSON，完整混排结构，记录内容的唯一事实来源；
   * 图片节点 src 为相对路径；无版式记录为 null
   */
  document: string | null;
  /** attachments 相对路径数组，JS 侧按 record_id 聚合；无图记录恒为 [] */
  imagePaths: string[];
  /** 标签名快照数组，损坏降级 [] */
  tags: string[];
}

/** 标签条目；color 为创建时从 TAG_COLOR_PALETTE 随机取值的 hex */
export interface Tag {
  id: number;
  name: string;
  color: string;
}

/** 标签名最大长度；trim 后 1~20 字，DAO 单点校验 */
export const TAG_NAME_MAX_LENGTH = 20;

/** 预置标签色板，不做自由取色 */
export const TAG_COLOR_PALETTE: readonly string[] = [
  '#f59e0b',
  '#ef4444',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

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
  /** invoke：标签库列表 */
  tagsList: 'tags:list',
  /** invoke：新建标签（重名返回已有条目） */
  tagsCreate: 'tags:create',
  /** invoke：重命名标签 */
  tagsRename: 'tags:rename',
  /** invoke：删除标签（不回溯记录快照） */
  tagsDelete: 'tags:delete',
  /** invoke：读取上次提交的标签组合记忆 */
  tagsLastGet: 'tags:lastGet',
  /** invoke：记忆本次提交的标签组合 */
  tagsLastSet: 'tags:lastSet',
} as const;

/**
 * 图文整包：文字可选 + 图片不限张数，字节 structured clone；
 * document 为 Lexical EditorState JSON，完整版式入库存档、为编辑功能预埋。
 */
export interface CreateCapturePayload {
  text: string;
  document?: string | null;
  images: { data: Uint8Array; sizeBytes: number }[];
  /** 标签名快照；缺省 = 不打标，入库 '[]' */
  tags?: string[];
}

/** 查询捕获记录的分页筛选载荷 */
export interface QueryCapturesPayload {
  keyword?: string;
  since?: string;
  /** ISO 8601 结束时间（含该秒），缺省不过滤 */
  until?: string;
  /** true=仅含图，false=仅无图，缺省=全部 */
  hasImages?: boolean;
  /** 标签名数组，任一命中 OR；缺省/空数组 = 不过滤 */
  tagNames?: string[];
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

/** 新建标签载荷 */
export interface CreateTagPayload {
  name: string;
}

/** 重命名标签载荷 */
export interface RenameTagPayload {
  id: number;
  name: string;
}

/** 删除标签载荷 */
export interface DeleteTagPayload {
  id: number;
}

/** 记忆本次提交的标签组合，与库条目解耦 */
export interface SetLastTagsPayload {
  names: string[];
}

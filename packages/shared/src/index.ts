/**
 * 共享类型。
 *
 * M4 起捕获记录支持图文整包：记录可携带文字与多张图片，图片关联
 * attachments 相对路径（相对 userData 根）。
 */
/**
 * AI 摘要分级（analyses.grade 三档枚举）：画像权重『AI 判重点』数据来源
 */
export type Grade = 'high' | 'mid' | 'low';

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
  /** AI 一句话摘要（analyses.summary）；无摘要的存量记录为 null/undefined */
  aiSummary?: string | null;
  /** AI 摘要分级（analyses.grade）；无分级（grade 为 NULL）的记录为 null/undefined */
  aiGrade?: Grade | null;
  /** 曾纳入画像汇总的时间戳（analyses.profiled_at）；NULL/undefined = 未纳入 */
  aiProfiledAt?: string | null;
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
  /** invoke：读取画像状态（画像文档 + 上次汇总时间 + 待汇总数 + 汇总中标记） */
  profileGet: 'profile:get',
  /** invoke：立即触发画像汇总 */
  profileSummarize: 'profile:summarize',
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
  /** 级别单值过滤（analyses.grade），缺省 = 全部；仅匹配非 NULL 记录 */
  grade?: Grade;
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

/** capture:create 无意义判定时主进程抛出的固定错误文案；渲染层据此区分 toast 文案 */
export const AI_NOT_MEANINGFUL_MESSAGE = '内容未拾光：AI 判定无有效信息';

/**
 * AI 用户画像：固定 6 槽位，每槽位为一段描述性文字（string），缺键/null/空串
 * 表示该槽位无内容；key 英文，中文展示文案由前端映射：身份概况/最近关注/兴趣爱好/在意的事/长期方向/其他
 */
export interface ProfileDocument {
  identity?: string | null;
  recent?: string | null;
  interests?: string | null;
  values?: string | null;
  goals?: string | null;
  misc?: string | null;
}

/** profile:get 响应 */
export interface ProfileStatusPayload {
  document: ProfileDocument | null;
  updatedAt: string | null;
  pendingCount: number;
  running: boolean;
}

/** profile:summarize 响应 */
export interface ProfileSummarizeResult {
  ok: boolean;
  error?: string;
}

/**
 * RichCapturePreview 混排预览（图文统一模型 · 展示层）：
 * 记录内容的唯一事实来源是 record.document（Lexical EditorState JSON），
 * image 节点 src 已由主进程重写为相对路径（如 'images/<uuid>.png'）。
 *
 * 序列化契约（官方方案，替换早期手写 parseDocument）：
 * - documentToHtml 用 headless 编辑器（createEditor + disableEvents:true，
 *   即官方 createHeadlessEditor 的本质；0.52 核心包未导出该符号）parse EditorState，
 *   再经 @lexical/html 的 $generateHtmlFromNodes 导出 HTML——段落内图文混排不再丢字，
 *   并顺带获得 format 富文本渲染（加粗 <strong> / 斜体 <em> 等）；
 * - ImageNode 必须实现 exportDOM()（decorate() 的 JSX 不进导出 HTML）；
 * - img 协议 URL 重写时机：官方序列化之后、入 React 之前——DOMParser 解析导出的
 *   HTML，每个 img 的 src 只取 basename 重写为 shiguang-image://<basename>
 *   （协议只认 basename，与旧 RecordRow imageSrc 逻辑一致）；
 * - text 兜底条件：document 为 null / JSON 损坏或结构非法（parseEditorState 抛错）/
 *   导出 HTML 为空或纯空白 → 回退渲染单个 <p>；
 * - 兼容归一化：官方 parseEditorState 要求 root 带 type:"root"，早期手写/极简
 *   document（缺该字段）会被静默吞成空文档，故解析前对缺 type 的 root 补 'root'
 *   （真实持久化 document 均为 toJSON() 完整形状，此 shim 只惠及极简形态）。
 *
 * 版式契约：导出的 HTML 无 class，由容器 Tailwind arbitrary variant
 * （[&_p]:… / [&_img]:…，Tailwind 3.4 支持且类名字面存在于源码可被扫描）施加：
 * 段落 text-sm text-neutral-700 whitespace-pre-wrap break-words；
 * img max-w-full rounded-md border border-neutral-200。
 * 未选 index.css 后代选择器方案：本文件不在本次改动白名单内。
 *
 * 收起态：内容容器限高 max-h-40 + overflow-hidden，底部叠加白色渐变遮罩；
 * 展开态不设限高。收起/展开由父级 expanded 驱动，本组件不处理点击。
 * 图片加载失败不做特殊占位：磁盘文件被删属异常情况，浏览器原生破损图
 * 展示已可辨识。
 */
import * as React from 'react';
import { createEditor, ParagraphNode, TextNode } from 'lexical';
import { $generateHtmlFromNodes } from '@lexical/html';
import { ImageNode } from '../input/features/capture/image-node';

export interface RichCapturePreviewProps {
  /** Lexical EditorState JSON；null 或解析失败时走 text 兜底 */
  document: string | null;
  /** document 解析失败的兜底渲染源 */
  text: string;
  /** 展开态（父级驱动）：false 时限高 + 渐变遮罩 */
  expanded: boolean;
}

const PARAGRAPH_CLASS = 'whitespace-pre-wrap break-words text-sm text-neutral-700';

/** 承载导出 HTML 的容器：无 class 标签由后代 arbitrary variant 施加版式 */
const HTML_CONTAINER_CLASS =
  'text-sm text-neutral-700 [&_p]:whitespace-pre-wrap [&_p]:break-words [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-neutral-200';

/**
 * document（Lexical EditorState JSON）→ 渲染 HTML；
 * 解析失败 / 导出为空 → null（调用方回退 text）。
 */
function documentToHtml(document: string): string | null {
  // headless 编辑器：disableEvents 即官方 createHeadlessEditor 的等价配置
  const editor = createEditor({
    namespace: 'shiguang-preview',
    nodes: [ParagraphNode, TextNode, ImageNode],
    onError: () => {},
    disableEvents: true,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return null;
  }
  // 兼容归一化：root 缺 type 时补 'root'，避免官方解析器静默吞掉极简 document
  if (typeof parsed === 'object' && parsed !== null) {
    const root = (parsed as { root?: unknown }).root;
    if (typeof root === 'object' && root !== null && (root as { type?: unknown }).type === undefined) {
      (root as { type?: unknown }).type = 'root';
    }
  }
  try {
    editor.setEditorState(editor.parseEditorState(JSON.stringify(parsed)));
  } catch {
    return null;
  }
  const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor, null));
  if (html.trim() === '') return null;

  // 协议 URL 重写：官方序列化之后、入 React 之前，src 只取 basename
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const basename = img.getAttribute('src')?.split('/').pop();
    if (basename) img.setAttribute('src', `shiguang-image://${basename}`);
  }
  return doc.body.innerHTML;
}

export function RichCapturePreview({ document, text, expanded }: RichCapturePreviewProps) {
  const html = React.useMemo(
    () => (document === null ? null : documentToHtml(document)),
    [document],
  );

  return (
    <div className="relative">
      <div className={expanded ? '' : 'max-h-40 overflow-hidden'}>
        {html !== null ? (
          <div className={HTML_CONTAINER_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className={PARAGRAPH_CLASS}>{text}</p>
        )}
      </div>
      {!expanded && (
        /* 收起态底部渐变遮罩：提示内容可展开 */
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />
      )}
    </div>
  );
}

export default RichCapturePreview;

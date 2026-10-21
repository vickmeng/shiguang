/**
 * 拾光输入表单（任务 15，Lexical 形态；TanStack Form 自输入框退役）。
 *
 * 行为契约：
 * - 布局（2026-10-20 微信式改版）：边框容器即整体——ContentEditable 输入区
 *   在容器内滚动（flex-1 + overflow-y-auto），底部操作条（pasteHint + 提交
 *   按钮）固定在边框容器内不参与滚动；placeholder 与字数统计展示已移除；聚焦态
 *   边框经容器 focus-within 实现
 * - LexicalComposer（namespace 'shiguang-capture'，nodes: Paragraph/Text/Image）
 *   为根，RichTextPlugin 的 ContentEditable 取代原 textarea（autoFocus、
 *   min-h-[160px] flex-1 overflow-y-auto 内部滚动不撑外部窗口）
 * - 5000 字上限经 editor.registerUpdateListener 订阅 editorState 硬拦截
 *   （不 trim，无字数展示）；文本长度超限时经 microtask 调
 *   editor.setEditorState(prevEditorState) 整体回退到上一个 editorState
 *   （超限输入被整体丢弃；setEditorState 在 listener 同步上下文中不生效，
 *   故须等 commit 落定），回退后 listener 再次触发，内部计数保持一致
 * - 空内容（textContent.length === 0 且 ImageNode 数为 0）提交按钮禁用；
 *   全空格/换行视为有内容；仅含图片无文字时可提交
 * - 提交反馈收敛在提交按钮上（不替换整表内容）：idle「拾光」→ submitting
 *   「拾光中…」→ success「✓ 已拾光」/ error「提交失败」，成功/失败态闪现
 *   STATUS_RESET_DELAY_MS 后自动回到 idle 可录态；成功回 idle 时清空编辑器
 *   （已入库，准备下一条）；失败保留内容供重试。窗口不自动收起。
 * - imageBytesRef 以节点 key 关联粘贴图片字节（粘贴分流由任务 17 接管）；
 *   提交编排（任务 18）：text 取 `$getRoot().getTextContent()`（段落 \n 分隔，
 *   ImageNode 不贡献字符），images 字节按文档顺序由 `$nodesOfType(ImageNode)`
 *   的 key 从 ref 取出，整包 `{ data, sizeBytes }`；document 为
 *   `JSON.stringify(editorState.toJSON())` 完整版式 JSON（入库存档、编辑预埋）；
 *   成功后按钮闪现「✓ 已拾光」，闪现落定时清空编辑器 + revoke 全部
 *   objectURL + `imageBytesRef.current.clear()`；失败闪现「提交失败」，
 *   编辑器内容（含图片节点与字节）原样保留供重试；组件卸载 effect
 *   revoke 编辑器内全部 objectURL（blob: 前缀守卫）
 * - 粘贴分流（PASTE_COMMAND，COMMAND_PRIORITY_HIGH）：clipboardData 含
 *   图片文件时逐张读字节、URL.createObjectURL 生成 src，以 $insertNodes 插在
 *   当前 selection 处（字节存入 imageBytesRef，key = 节点 getKey()）；剪贴板
 *   还带文字时 return false 交 Lexical 默认粘贴处理文字；纯非图片文件提示
 *   pasteHint「暂不支持」并消费命令；无文件直接放行；卸载时命令随 effect
 *   清理一并注销
 * - 截图功能已移除（M4）：不再内置区域截图入口，用户改用系统截图
 *   （Shift+Cmd+Ctrl+4）后经 Cmd+V 粘贴
 * - 容器级 Esc 调 input.close()；编辑器 blur 不主动调 input.blur()——
 *   否则点击「拾光」按钮的 mousedown 先触发 blur 同步收起窗口，click 落不到按钮。
 *   收起由主进程 inputWindow 的窗口级原生 blur 事件承担（焦点离开整个输入框
 *   窗口才触发），preload 的 input.blur() 仅作预留口子保留。
 */
import * as React from 'react';
import type { InitialConfigType } from '@lexical/react/LexicalComposer';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import {
  $getRoot,
  $getSelection,
  $insertNodes,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  ParagraphNode,
  TextNode,
  type PasteCommandType,
} from 'lexical';
import { Button } from '../../../components/ui/button';
import { $createImageNode, ImageNode } from './image-node';

const MAX_LENGTH = 5000;
/** 成功/失败态展示时长（操作确认闪现惯例 0.4~0.8s），之后自动回到可录态 */
const STATUS_RESET_DELAY_MS = 600;

const editorInitialConfig: InitialConfigType = {
  namespace: 'shiguang-capture',
  nodes: [ParagraphNode, TextNode, ImageNode],
  onError: (error: Error) => {
    throw error;
  },
  theme: {},
};

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

/**
 * 表单主体：须在 LexicalComposer 内渲染（编辑器实例经
 * useLexicalComposerContext 获取）；导出供测试在同一 Composer 内直控编辑器。
 */
export function CaptureFormInner() {
  const [editor] = useLexicalComposerContext();
  const [status, setStatus] = React.useState<SubmitStatus>('idle');
  const [textLength, setTextLength] = React.useState(0);
  const [imageNodeCount, setImageNodeCount] = React.useState(0);
  const imageBytesRef = React.useRef<Map<string, Uint8Array>>(new Map());
  const statusTimerRef = React.useRef<number | null>(null);
  const [pasteHint, setPasteHint] = React.useState<string | null>(null);

  React.useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, prevEditorState }) => {
        const len = editorState.read(() => $getRoot().getTextContent().length);
        if (len > MAX_LENGTH) {
          // 超 5000 字整体回退到上一个 editorState。setEditorState 在
          // listener 同步上下文中不会触发提交（Lexical 0.52 实测），
          // 经 microtask 在 commit 落定后回退；回退后 listener 再次触发，
          // 字数统计与图片计数随回退后的 state 同步
          queueMicrotask(() => editor.setEditorState(prevEditorState));
          return;
        }
        setTextLength(len);
        setImageNodeCount(editorState.read(() => $nodesOfType(ImageNode).length));
      }),
    [editor],
  );

  React.useEffect(
    () => () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    },
    [],
  );

  // 粘贴分流：图片文件插入 ImageNode 并暂存字节；混合剪贴板的文字交
  // Lexical 默认粘贴；纯非图片文件提示「暂不支持」。registerCommand 的
  // 返回值即注销函数，随组件卸载清理。
  React.useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event: PasteCommandType) => {
          const clipboardData =
            'clipboardData' in event ? event.clipboardData : null;
          if (!clipboardData) {
            return false;
          }
          const files = Array.from(clipboardData.files ?? []);
          if (files.length === 0) {
            return false;
          }
          const imageFiles = files.filter((file) =>
            file.type.startsWith('image/'),
          );
          if (imageFiles.length === 0) {
            setPasteHint('暂不支持');
            event.preventDefault();
            return true;
          }
          setPasteHint(null);
          event.preventDefault();
          void (async () => {
            for (const file of imageFiles) {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const src = URL.createObjectURL(
                new Blob([bytes], { type: 'image/png' }),
              );
              editor.update(() => {
                if ($getSelection() === null) {
                  $getRoot().selectEnd();
                }
                const node = $createImageNode({ src });
                $insertNodes([node]);
                imageBytesRef.current.set(node.getKey(), bytes);
              });
            }
          })();
          // 混合剪贴板（文字 + 图片）：图片已由本 handler 插入，文字部分
          // 交 Lexical 默认粘贴处理（return false 继续传播给 EDITOR 优先级
          // 的默认 handler）；纯图片剪贴板直接消费命令
          const hasText = Boolean(
            clipboardData.getData('text/plain') ||
              clipboardData.getData('text/html'),
          );
          return !hasText;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  const busy = status !== 'idle';

  // 卸载兜底：编辑器内残留的 objectURL（未提交成功的图片）全部 revoke，
  // 防 blob 泄漏；ref 随组件消亡一并丢弃
  React.useEffect(
    () => () => {
      editor.getEditorState().read(() => {
        for (const node of $nodesOfType(ImageNode)) {
          const src = node.getSrc();
          if (src.startsWith('blob:')) {
            URL.revokeObjectURL?.(src);
          }
        }
      });
      imageBytesRef.current.clear();
    },
    [editor],
  );

  const handleSubmit = async () => {
    if (busy) {
      return;
    }
    const editorState = editor.getEditorState();
    const text = editorState.read(() => $getRoot().getTextContent());
    // bytes 顺序 = 文档顺序（$nodesOfType 返回文档序）
    const bytes = editorState.read(() =>
      $nodesOfType(ImageNode).map((node) => imageBytesRef.current.get(node.getKey())!),
    );
    const document = JSON.stringify(editorState.toJSON());
    setStatus('submitting');
    try {
      await window.api.capture.create({
        text,
        document,
        images: bytes.map((data) => ({ data, sizeBytes: data.length })),
      });
      setStatus('success');
      statusTimerRef.current = window.setTimeout(() => {
        editor.update(() => {
          for (const node of $nodesOfType(ImageNode)) {
            const src = node.getSrc();
            if (src.startsWith('blob:')) {
              URL.revokeObjectURL?.(src);
            }
          }
          $getRoot().clear();
        });
        imageBytesRef.current.clear();
        setStatus('idle');
      }, STATUS_RESET_DELAY_MS);
    } catch {
      // 失败保留内容供重试，闪现后回到可录态
      setStatus('error');
      statusTimerRef.current = window.setTimeout(() => {
        setStatus('idle');
      }, STATUS_RESET_DELAY_MS);
    }
  };

  return (
    <div
      className="flex min-h-0 w-full flex-1 flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          window.api.input.close();
        }
      }}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        {/* 边框容器即整体（微信式布局）：滚动只发生在输入区（ContentEditable），
            底部操作条（提示 + 提交按钮）固定在边框容器内、不随内容滚动 */}
        <div className="flex min-h-0 flex-1 flex-col rounded-md border border-neutral-300 focus-within:border-neutral-400">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                autoFocus
                className="min-h-[160px] flex-1 resize-none overflow-y-auto select-text px-3 py-2 text-sm outline-none [caret-color:#262626]"
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span role="alert" className="text-xs text-neutral-400">
              {pasteHint ?? ''}
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={(textLength === 0 && imageNodeCount === 0) || busy}
              className={`h-8 rounded-full px-5 text-sm ${
                status === 'success'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-600'
                  : status === 'error'
                    ? 'bg-red-500 text-white hover:bg-red-500'
                    : ''
              }`}
            >
              {status === 'submitting'
                ? '拾光中…'
                : status === 'success'
                  ? '✓ 已拾光'
                  : status === 'error'
                  ? '提交失败'
                  : '拾光'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function CaptureForm() {
  return (
    <LexicalComposer initialConfig={editorInitialConfig}>
      <CaptureFormInner />
    </LexicalComposer>
  );
}

export default CaptureForm;

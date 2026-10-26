/**
 * RecordDetailDialog 记录详情弹窗（console 域组件）：记录页表格化后
 * 点击摘要整格弹出的只读详情弹窗——
 * 版式沿用 ConfirmDialog 遮罩模式（fixed inset-0 z-50、半透明遮罩点击关闭、
 * role="dialog" aria-modal），卡片由 react-rnd <Rnd> 承载：
 * - 拖动/缩放：bounds="parent" 限制在遮罩内，dragHandleClassName=
 *   "record-detail-header"（元信息行头部可拖拽移动），关闭按钮带
 *   record-detail-close-btn 并经 Rnd cancel 选择器排除，点击不被拖拽吞掉；
 *   仅右下角可缩放（最小 480×320、最大 90vw×90vh），右下角手柄类
 *   record-detail-resize-handle（样式在 index.css，因 re-resizable 手柄
 *   默认 inline style 无法用 Tailwind 类覆盖）；
 * - 卡片自身不滚动：Rnd 根为 flex 列（overflow-hidden 白卡圆角阴影），
 *   元信息行（时间 / 级别徽标 / 标签 chips）固定为头部
 *   （border-b + record-detail-header，pr-10 避让关闭按钮），
 *   全文区 flex-1 min-h-0 overflow-y-auto select-text 为唯一滚动容器
 *   （全局 user-select:none 下放开正文滑动选中）；
 * - 居中打开：Rnd position 受控，open 后 useLayoutEffect 测量遮罩与卡片
 *   实际尺寸（height:auto）算居中坐标，onDrag 回写保证拖拽顺滑（受控
 *   Draggable 仅在 onDrag 更新才不冻结）；关闭时 pos 复位，下次打开重新居中；
 * 数据直接用当前列表行的 record 对象（列表 LEFT JOIN 已带全量字段），
 * 不新增 IPC 查询；
 * 全文区复用 RichCapturePreview 并传 expanded=true——表格无内容预览列后，
 * expanded 语义仅由本弹窗消费（行内 expand 机制已随表格化整体移除）；
 * 元信息行（时间 / 级别徽标 / 标签 chips）与 RecordRow 同款渲染逻辑，
 * 级别徽标映射（GradeBadge）由本文件导出供 RecordRow import 复用，避免双份漂移；
 * 只读：不渲染复制/删除按钮，关闭仅走遮罩点击与「×」按钮（不做 ESC）。
 */
import * as React from 'react';
import { Rnd } from 'react-rnd';
import type { CaptureRecord, Grade } from '@shiguang/shared';
import { RichCapturePreview } from '../../components/rich-capture-preview';
import { tagTextColor } from '../../lib/tagTextColor';

const GRADE_BADGE_CLASS: Record<Grade, string> = {
  high: 'bg-red-50 text-red-600',
  mid: 'bg-neutral-100 text-neutral-600',
  low: 'bg-transparent border border-neutral-200 text-neutral-400',
};

const GRADE_BADGE_LABEL: Record<Grade, string> = {
  high: '高',
  mid: '中',
  low: '低',
};

/** 级别徽标（定稿配色：high 红 / mid 中性实底 / low 描边灰）；RecordRow 同级复用 */
export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${GRADE_BADGE_CLASS[grade]}`}>
      {GRADE_BADGE_LABEL[grade]}
    </span>
  );
}

export interface RecordDetailDialogProps {
  open: boolean;
  /** null 或 open=false 时返回 null（弹窗数据来自列表行，不独立查询） */
  record: CaptureRecord | null;
  /** 标签名 → 库内颜色的映射；缺省/缺项时色点灰显（与 RecordRow 同款） */
  tagColors?: Record<string, string>;
  onClose(): void;
}

export function RecordDetailDialog({ open, record, tagColors, onClose }: RecordDetailDialogProps) {
  const overlayRef = React.useRef<HTMLDivElement>(null);
  /** Rnd 受控位置：0,0 起渲染，open 后经 useLayoutEffect 测量实际尺寸居中
   *  （布局阶段完成，首帧无跳动）；onDrag 持续回写保证拖拽顺滑；关闭复位 */
  const [pos, setPos] = React.useState({ x: 0, y: 0 });

  React.useLayoutEffect(() => {
    if (!open) {
      setPos({ x: 0, y: 0 });
      return;
    }
    const overlay = overlayRef.current;
    const dialog = overlay?.querySelector<HTMLElement>('[role="dialog"]');
    if (!overlay || !dialog) return;
    setPos({
      x: Math.max(0, Math.round((overlay.clientWidth - dialog.offsetWidth) / 2)),
      y: Math.max(0, Math.round((overlay.clientHeight - dialog.offsetHeight) / 2)),
    });
  }, [open, record?.id]);

  if (!open || !record) return null;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 半透明遮罩：点击关闭（同时作为 Rnd bounds="parent" 的拖动/缩放边界） */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <Rnd
        role="dialog"
        aria-modal="true"
        className="relative max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        style={{ display: 'flex', flexDirection: 'column' }}
        default={{ x: 0, y: 0, width: '672px', height: 'auto' }}
        position={pos}
        minWidth={480}
        minHeight={320}
        maxWidth="90vw"
        maxHeight="90vh"
        bounds="parent"
        dragHandleClassName="record-detail-header"
        cancel=".record-detail-close-btn"
        onDrag={(_e, d) => setPos({ x: d.x, y: d.y })}
        enableResizing={{ bottomRight: true }}
        resizeHandleClasses={{ bottomRight: 'record-detail-resize-handle' }}
      >
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="record-detail-close-btn absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100"
        >
          ×
        </button>
        {/* 元信息行（头部，固定不滚动；record-detail-header 兼作 Rnd 拖拽把手）：
            时间 / 级别徽标 / 标签 chips（实心 chips 与 RecordRow 同款） */}
        <div className="record-detail-header flex flex-wrap items-center gap-2 border-b border-neutral-100 px-5 pb-3 pr-10 pt-4">
          <span className="text-xs text-neutral-400">
            {new Date(record.createdAt).toLocaleString()}
          </span>
          {record.aiGrade ? <GradeBadge grade={record.aiGrade} /> : null}
          {record.tags.map((name) => {
            const bg = tagColors?.[name] ?? '#d4d4d4';
            return (
              <span
                key={name}
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: bg,
                  color: tagColors?.[name] ? tagTextColor(bg) : '#ffffff',
                }}
              >
                {name}
              </span>
            );
          })}
        </div>
        {/* 全文区：唯一滚动容器（头部/关闭按钮固定）；document 混排忠实渲染，expanded 展开态；
            select-text 放开全局 user-select:none，支持鼠标滑动选中正文 */}
        <div className="min-h-0 flex-1 select-text overflow-y-auto px-5 pb-5 pt-3">
          <RichCapturePreview document={record.document} text={record.text} expanded />
        </div>
      </Rnd>
    </div>
  );
}

export default RecordDetailDialog;

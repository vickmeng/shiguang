/**
 * RecordDetailDialog 记录详情弹窗（console 域组件）：记录页表格化后
 * 点击摘要整格弹出的只读详情弹窗——
 * 版式沿用 ConfirmDialog 遮罩模式（fixed inset-0 z-50、半透明遮罩点击关闭、
 * role="dialog" aria-modal），卡片更宽（max-w-2xl）以承载全文；
 * 数据直接用当前列表行的 record 对象（列表 LEFT JOIN 已带全量字段），
 * 不新增 IPC 查询；
 * 全文区复用 RichCapturePreview 并传 expanded=true——表格无内容预览列后，
 * expanded 语义仅由本弹窗消费（行内 expand 机制已随表格化整体移除）；
 * 元信息行（时间 / 级别徽标 / 标签 chips）与 RecordRow 同款渲染逻辑，
 * 级别徽标映射（GradeBadge）由本文件导出供 RecordRow import 复用，避免双份漂移；
 * 只读：不渲染复制/删除按钮，关闭仅走遮罩点击与「×」按钮（不做 ESC）。
 */
import * as React from 'react';
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
  if (!open || !record) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 半透明遮罩：点击关闭 */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
      >
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100"
        >
          ×
        </button>
        {/* 元信息行：时间 / 级别徽标 / 标签 chips（实心 chips 与 RecordRow 同款） */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-400">
            {new Date(record.createdAt).toLocaleString()}
          </span>
          {record.aiGrade ? <GradeBadge grade={record.aiGrade} /> : null}
          {record.tags.map((name) => {
            const bg = tagColors?.[name] ?? '#d4d4d4';
            return (
              <span
                key={name}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
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
        {/* 全文区：document 混排忠实渲染，expanded 展开态 */}
        <div className="mt-3">
          <RichCapturePreview document={record.document} text={record.text} expanded />
        </div>
      </div>
    </div>
  );
}

export default RecordDetailDialog;

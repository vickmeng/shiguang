/**
 * 记录表格行：RecordsPage <table> 的单行 <tr> 子组件——
 * 六列固定列序：复选框 | 时间 | 摘要 | 级别 | 标签 | 操作（无内容预览列）。
 * 复选框常驻（aria-label「选择记录 N」），选中编排由父组件接线。
 * 摘要 td 为整格可点击 button 语义（text-left、line-clamp-2 两行截断）：
 * record.aiSummary 非空时点击回调 onOpenDetail（父级打开详情弹窗）；
 * null/undefined（无摘要的存量记录）渲染不可点击占位「—」。
 * 级别 td 按 record.aiGrade 渲染三档徽标（复用 record-detail-dialog 导出的
 * GradeBadge，避免双份映射漂移）；NULL/undefined（AI 未分级）时 td 留空。
 * 标签 td 沿用实心 chips 逻辑：底色 = 标签色 + 名称，底色取父级下发的
 * tagColors（库内标签用库色），文字色经 tagTextColor 按底色亮度自动切换；
 * tagColors 缺失该项名（已删标签）实心灰 #d4d4d4 + 白字。
 * 操作 td 为复制/删除按钮（tr 无整行点击，不再需要 stopPropagation）：
 * 复制分流保留——imagePaths.length > 0 走 window.api.capture.copyImage({ id })
 * （主进程复制首图到剪贴板），纯文字行维持 navigator.clipboard.writeText，
 * 成功后均弹 toast「已复制到剪贴板」（Toaster 由父页面挂载）。
 * 图文全文预览（RichCapturePreview expanded）已由详情弹窗承接，本组件不渲染。
 */
import * as React from 'react';
import type { CaptureRecord } from '@shiguang/shared';
import { toast } from '../../components/ui/toast';
import { tagTextColor } from '../../lib/tagTextColor';
import { GradeBadge } from './record-detail-dialog';

export interface RecordRowProps {
  record: CaptureRecord;
  selected: boolean;
  /** 标签名 → 库内颜色的映射（父级 RecordsPage 由 tags:list 派生）；缺省/缺项时色点灰显 */
  tagColors?: Record<string, string>;
  onToggleSelect(): void;
  /** 摘要 td 点击回调，父级打开详情弹窗 */
  onOpenDetail(): void;
  onDelete(): void;
}

export function RecordRow({ record, selected, tagColors, onToggleSelect, onOpenDetail, onDelete }: RecordRowProps) {
  /** 复制：含图行走主进程复制首图到剪贴板，纯文字行走浏览器剪贴板 */
  const handleCopy = () => {
    if (record.imagePaths.length > 0) {
      void window.api.capture.copyImage({ id: record.id }).then(() => {
        toast('已复制到剪贴板');
      });
    } else {
      void navigator.clipboard.writeText(record.text).then(() => {
        toast('已复制到剪贴板');
      });
    }
  };

  return (
    <tr className="border-t border-neutral-200 first:border-t-0 align-top">
      {/* 复选框列 */}
      <td className="p-3">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`选择记录 ${record.id}`}
          onChange={onToggleSelect}
        />
      </td>
      {/* 时间列 */}
      <td className="p-3 text-xs text-neutral-400 whitespace-nowrap">
        {new Date(record.createdAt).toLocaleString()}
      </td>
      {/* 摘要列：整格可点击弹详情；无摘要渲染不可点击占位 */}
      <td className="p-3 max-w-md">
        {record.aiSummary ? (
          <button
            type="button"
            onClick={onOpenDetail}
            className="block w-full text-left text-sm text-neutral-700 line-clamp-2"
          >
            {record.aiSummary}
          </button>
        ) : (
          <span className="text-sm text-neutral-300">—</span>
        )}
      </td>
      {/* 级别列：三档徽标（GradeBadge 复用）；NULL/undefined 留空 */}
      <td className="p-3">
        {record.aiGrade ? <GradeBadge grade={record.aiGrade} /> : null}
      </td>
      {/* 标签列：实心 chips；库内标签取库色（文字随亮度），已删标签灰底白字 */}
      <td className="p-3">
        {record.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
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
        )}
      </td>
      {/* 操作列 */}
      <td className="p-3 whitespace-nowrap">
        <button
          type="button"
          aria-label={`复制记录 ${record.id}`}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
          onClick={handleCopy}
        >
          复制
        </button>
        <button
          type="button"
          aria-label={`删除记录 ${record.id}`}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          onClick={onDelete}
        >
          删除
        </button>
      </td>
    </tr>
  );
}

export default RecordRow;

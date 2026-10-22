/**
 * 记录行：从 RecordsPage 平移的单条记录 li 子组件——
 * 常驻复选框（阻止冒泡避免误触展开）、内容区、复制按钮、删除按钮（均阻止冒泡）；
 * 内容区统一走 RichCapturePreview（图文统一模型）：record.document 为唯一事实来源，
 * 忠实渲染混排版式；document 解析失败时组件内部回退 record.text。
 * 收起态由预览组件限高 max-h-40 + 底部渐变遮罩，展开态（expanded 由父级状态驱动）
 * 不设限高；不再有「含图/纯文字」分流、缩略图/「共N张」角标等图片特殊形态。
 * 复制按钮分流保留：imagePaths.length > 0 走 window.api.capture.copyImage({ id })
 * （主进程复制首图到剪贴板），纯文字行维持 navigator.clipboard.writeText，
 * 成功后均弹 toast「已复制到剪贴板」（Toaster 由父页面挂载，与 RecordsPage 同语义）。
 * 标签 chips 行挂载于时间戳 <p> 上方：record.tags 非空时渲染实心 chips
 * （底色 = 标签色 + 名称），底色取父级下发的 tagColors（库内标签用库色），
 * 文字色经 tagTextColor 按底色亮度自动切换；tagColors 缺失该项名（已删标签）
 * 实心灰 #d4d4d4 + 白字。
 * 行结构自 RecordsPage 现行 li 平移，选中/展开/删除编排由父组件接线。
 */
import * as React from 'react';
import type { CaptureRecord } from '@shiguang/shared';
import { RichCapturePreview } from '../../components/rich-capture-preview';
import { toast } from '../../components/ui/toast';
import { tagTextColor } from '../../lib/tagTextColor';

export interface RecordRowProps {
  record: CaptureRecord;
  expanded: boolean;
  selected: boolean;
  /** 标签名 → 库内颜色的映射（父级 RecordsPage 由 tags:list 派生）；缺省/缺项时色点灰显 */
  tagColors?: Record<string, string>;
  onToggleExpand(): void;
  onToggleSelect(): void;
  onDelete(): void;
}

export function RecordRow({ record, expanded, selected, tagColors, onToggleExpand, onToggleSelect, onDelete }: RecordRowProps) {
  /** 复制：含图行走主进程复制首图到剪贴板，纯文字行走浏览器剪贴板 */
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
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
    <li
      className="flex cursor-pointer items-start gap-3 p-3"
      onClick={onToggleExpand}
    >
      {/* 常驻复选框：阻止冒泡避免误触展开 */}
      <input
        type="checkbox"
        checked={selected}
        aria-label={`选择记录 ${record.id}`}
        className="mt-1 shrink-0"
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleSelect}
      />
      <div className="min-w-0 flex-1">
        {/* 内容区：document 混排忠实渲染（收起/展开由 expanded 驱动） */}
        <RichCapturePreview
          document={record.document}
          text={record.text}
          expanded={expanded}
        />
        <p className="mt-1 text-xs text-neutral-400">
          {new Date(record.createdAt).toLocaleString()}
        </p>
        {record.tags.length > 0 && (
          /* 实心标签 chips：时间戳上方；库内标签取库色（文字随亮度），已删标签灰底白字 */
          <div className="mt-1 flex flex-wrap gap-1">
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
      </div>
      {/* 复制按钮：阻止冒泡避免误触展开 */}
      <button
        type="button"
        aria-label={`复制记录 ${record.id}`}
        className="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
        onClick={handleCopy}
      >
        复制
      </button>
      {/* 删除按钮：弹出确认框后再真正删除；阻止冒泡避免误触展开 */}
      <button
        type="button"
        aria-label={`删除记录 ${record.id}`}
        className="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        删除
      </button>
    </li>
  );
}

export default RecordRow;

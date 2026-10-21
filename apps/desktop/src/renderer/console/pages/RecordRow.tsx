/**
 * 记录行（M4 任务 19）：从 RecordsPage 平移的单条记录 li 子组件——
 * 常驻复选框（阻止冒泡避免误触展开）、内容区、复制按钮、删除按钮（均阻止冒泡）；
 * 内容区按 record.imagePaths.length > 0 分流（M4 改造：imagePaths 派生自 attachments 聚合）：
 * - 纯文字行（imagePaths 恒为 []）：截断/展开全文预览（line-clamp-3 语义不变，expanded 由父级状态驱动）；
 * - 含图行：渲染 shiguang-image:// 缩略图（宽约 96px、object-contain、圆角边框）替代文字预览，
 *   多图（length > 1）时缩略块右上角叠加「共N张」角标；
 * 展开态：文字行移除截断，含图行由缩略图切换为纵向全列单图（max-w-[480px] w-full object-contain）；
 * 复制按钮：含图行调 window.api.capture.copyImage({ id })（主进程复制首图到剪贴板），
 * 纯文字行维持 navigator.clipboard.writeText，
 * 成功后均弹 toast「已复制到剪贴板」（Toaster 由父页面挂载，与 RecordsPage 同语义）。
 * 行结构自 RecordsPage 现行 li 平移，选中/展开/删除编排由父组件接线（任务 20）。
 */
import * as React from 'react';
import type { CaptureRecord } from '@shiguang/shared';
import { toast } from '../../components/ui/toast';

export interface RecordRowProps {
  record: CaptureRecord;
  expanded: boolean;
  selected: boolean;
  onToggleExpand(): void;
  onToggleSelect(): void;
  onDelete(): void;
}

/** 相对 imagePaths 项（'images/<uuid>.png'）→ 协议 URL 的 basename（协议只认 basename） */
function imageSrc(relativePath: string): string {
  const basename = relativePath.split('/').pop() ?? relativePath;
  return `shiguang-image://${basename}`;
}

export function RecordRow({ record, expanded, selected, onToggleExpand, onToggleSelect, onDelete }: RecordRowProps) {
  /** 图片加载失败（磁盘文件被删等）：渲染「图片丢失」占位，替代缩略图/大图 */
  const [imgError, setImgError] = React.useState(false);

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
        {record.imagePaths.length > 0 ? (
          imgError ? (
            /* 「图片丢失」占位：灰色虚线框，复制/删除按钮仍可用 */
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
              图片丢失
            </div>
          ) : expanded ? (
            /* 纵向全列单图：展开态替代缩略图，占满内容列（上限 480px） */
            <img
              src={imageSrc(record.imagePaths[0])}
              alt={`截图记录 ${record.id} 大图`}
              className="max-w-[480px] w-full rounded-md border border-neutral-200 object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            <>
              <div className="relative inline-block">
                <img
                  src={imageSrc(record.imagePaths[0])}
                  alt={`截图记录 ${record.id}`}
                  className="w-24 rounded-md border border-neutral-200 object-contain"
                  onError={() => setImgError(true)}
                />
                {record.imagePaths.length > 1 && (
                  /* 多图角标：缩略块右上角 */
                  <span className="absolute right-0 top-0 rounded-tr-md rounded-bl-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] leading-none text-white">
                    共{record.imagePaths.length}张
                  </span>
                )}
              </div>
            </>
          )
        ) : (
          <p
            className={
              expanded
                ? 'whitespace-pre-wrap break-words text-sm text-neutral-700'
                : 'line-clamp-3 whitespace-pre-wrap break-words text-sm text-neutral-700'
            }
          >
            {record.text}
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          {new Date(record.createdAt).toLocaleString()}
        </p>
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

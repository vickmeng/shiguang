// TagSelect 行为契约（输入框打标 / 记录筛选复用单组件）：
// - 状态机 closed / filtering / creating（closed ↔ filtering 展开/点选/子串过滤；
//   filtering 内 Enter 选中首项、creating 即席新建（违规名/reject 静默忽略）均已落地）;
// - blur 时序铁律：候选项与删除按钮一律 onMouseDown + e.preventDefault()（mousedown 抢跑 click，
//   preventDefault 阻止 input 失焦）；input onBlur 只关下拉，禁止同步调 window.api.input.blur()；
// - Esc 在容器 onKeyDown stopPropagation（capture-form 容器级 Esc 会收输入窗口），只关下拉；
// - 下拉项 × 直删同步语义：onDeleteTag 发起后不 await，若该名正被选中则同步 onChange 移除
//   （UI 即时少项）；reject 静默吞掉，父级删库后刷新 tags 数组。
// - allowDelete（筛选场景）：false 时下拉候选项不渲染 × 删除按钮（防误触直删库），
//   输入框行为不变；chips 行的「移除标签」仅移除选中项，不删库。
// - 实心 chip 视觉（2026-10-21）：chips 底色 = tag.color 实心底、文字色按底色
//   亮度经 tagTextColor 自动切换（亮底深字/暗底白字），× 半透明白 hover 全白；
//   库内已删名称照常入 chips，实心灰 #d4d4d4 + 白字；下拉候选项为实心 mini-chip。
import * as React from 'react';
import { TAG_NAME_MAX_LENGTH } from '@shiguang/shared';
import type { Tag } from '@shiguang/shared';
import { tagTextColor } from '../../lib/tagTextColor';

export interface TagSelectProps {
  /** 已选标签名（有序、去重，由父级持有） */
  value: string[];
  onChange(next: string[]): void;
  /** 标签库（色点 + 下拉源）；onDeleteTag 后由父级刷新本数组 */
  tags: Tag[];
  /** 下拉每项删除按钮回调（父级调 tags:delete 并刷新；若正被选中由本组件同步从 value 移除） */
  onDeleteTag(tag: Tag): void | Promise<void>;
  /** 即席新建开关：true 时 Enter 无候选走 onCreateTag；false（筛选场景）只可选已有 */
  allowCreate?: boolean;
  /** 下拉候选项删除按钮开关：缺省 true；false（筛选场景防误触直删库）不渲染 × */
  allowDelete?: boolean;
  /** allowCreate=true 时必填（父级调 tags:create；重名返回已有条目自然落入选中路径） */
  onCreateTag?(name: string): Promise<Tag>;
  /** 缺省 '标签' */
  placeholder?: string;
  /** 缺省 '标签' */
  'aria-label'?: string;
}

export function TagSelect({
  value,
  onChange,
  tags,
  onDeleteTag,
  allowCreate = true,
  allowDelete = true,
  onCreateTag,
  placeholder = '标签',
  'aria-label': ariaLabel = '标签',
}: TagSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [filterText, setFilterText] = React.useState('');
  // filtering 态：非空文本按名称子串过滤候选
  const filteredTags =
    filterText === '' ? tags : tags.filter((t) => t.name.includes(filterText));

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // 只关下拉，绝不冒泡到 capture-form 容器级 Esc（会收输入窗口）
          e.stopPropagation();
          setOpen(false);
          return;
        }
        if (e.key === 'Backspace' && filterText === '' && value.length > 0) {
          onChange(value.slice(0, -1));
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        {value.map((name) => {
          const tag = tags.find((t) => t.name === name);
          // 实心 chip：库内底色 = tag.color（文字随亮度）；库外名称灰底白字
          const bg = tag?.color ?? '#d4d4d4';
          const fg = tag ? tagTextColor(bg) : '#ffffff';
          return (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ backgroundColor: bg, color: fg }}
            >
              {name}
              <button
                type="button"
                aria-label={`移除标签 ${name}`}
                className="text-white/70 hover:text-white"
                onClick={() => onChange(value.filter((n) => n !== name))}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // 候选非空：选中第一项并保持下拉开（点选同语义，追加 + 清空文本）
            if (filteredTags.length > 0) {
              onChange([...value, filteredTags[0].name]);
              setFilterText('');
              return;
            }
            // 候选为空：allowCreate=false 只可选已有，直接忽略
            if (!allowCreate) return;
            // creating 态即席新建：违规名称直接忽略；reject 静默吞掉
            const name = filterText.trim();
            if (name === '' || name.length > TAG_NAME_MAX_LENGTH) return;
            void onCreateTag!(name)
              .then((tag) => {
                onChange([...value, tag.name]);
                setFilterText('');
              })
              .catch(() => {});
          }}
          // blur 时序铁律：只关下拉，绝不同步收起窗口或调 input.blur()
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="min-w-[4rem] flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
        />
      </div>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-md"
        >
          {filteredTags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-1 px-2 py-1 text-sm">
              <div
                role="option"
                aria-selected={value.includes(tag.name)}
                className="flex flex-1 cursor-pointer items-center gap-2"
                onMouseDown={(e) => {
                  // blur 时序铁律：mousedown 抢跑 click，preventDefault 阻止 input 失焦
                  e.preventDefault();
                  onChange([...value, tag.name]);
                  setFilterText('');
                }}
              >
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                  style={{ backgroundColor: tag.color, color: tagTextColor(tag.color) }}
                >
                  {tag.name}
                </span>
              </div>
              {allowDelete ? (
                <button
                  type="button"
                  aria-label={`删除标签 ${tag.name}`}
                  className="text-neutral-400 hover:text-neutral-600"
                  onMouseDown={(e) => {
                    // blur 时序铁律：mousedown 抢跑 click，preventDefault 阻止 input 失焦
                    e.preventDefault();
                    // 直删同步语义：不 await，reject 静默吞掉；正被选中则同步从 value 移除
                    void Promise.resolve(onDeleteTag(tag)).catch(() => {});
                    if (value.includes(tag.name)) {
                      onChange(value.filter((n) => n !== tag.name));
                    }
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

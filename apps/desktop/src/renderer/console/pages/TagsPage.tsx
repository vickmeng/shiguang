/**
 * 标签维护页（任务 16/17）：列表 + 新建 + 行内重命名 + 删除二次确认——
 * 挂载即 tags:list 拉列表（refresh 复用，写操作成功后重拉）；
 * 列表项渲染实心名称 chip（底色 = tag.color，文字色经 tagTextColor 按底色
 * 亮度自动切换）+ 操作区（重命名/删除小按钮）；
 * 顶部新建行：受控 input（placeholder '新标签名'）+「新建」按钮——
 * trim 后调 tags:create，成功后清空 input 并 refresh
 * （重名返回已有 → refresh 后自然去重展示）；
 * 重命名（任务 17）：editingId 行内编辑态，点「重命名」名称处渲染
 * input（autoFocus，初值当前名）；Enter 或失焦提交 tags:rename（成功后 refresh），
 * Esc 取消（stopPropagation 不冒泡）；失焦与 Enter 共用同一提交入口，
 * editingId 置空后守卫天然防重复提交；
 * 删除（任务 17）：deleting 态弹自写 ConfirmDialog（destructive），
 * 确认后 tags:delete 成功才关闭 dialog 并 refresh；取消仅关闭；
 * 删除不回溯 records 快照（已入库记录保留标签文字，灰色展示）；
 * 空列表渲染空态文案「暂无标签」。
 */
import * as React from 'react';
import type { Tag } from '@shiguang/shared';
import { ConfirmDialog } from '../../components/ui/dialog';
import { tagTextColor } from '../../lib/tagTextColor';

export function TagsPage() {
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [input, setInput] = React.useState('');
  // 行内重命名（任务 17）：editingId 为编辑中的标签 id，editName 为受控输入
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState('');
  // 删除二次确认（任务 17）：null 表示未弹出，否则为待删除标签
  const [deleting, setDeleting] = React.useState<Tag | null>(null);

  /** 重新拉取标签列表（挂载与写操作成功后共用） */
  const refresh = React.useCallback(() => {
    void window.api.tags.list().then(setTags);
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = () => {
    const name = input.trim();
    void window.api.tags.create({ name }).then(() => {
      setInput('');
      refresh();
    });
  };

  /** 进入行内重命名：初值为当前名称 */
  const handleStartRename = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  /** 提交重命名：Enter 与失焦共用入口；editingId 守卫防 Enter 后 blur 二次提交 */
  const handleSubmitRename = () => {
    if (editingId === null) return;
    const id = editingId;
    setEditingId(null);
    void window.api.tags.rename({ id, name: editName }).then(() => {
      refresh();
    });
  };

  /** 确认删除（任务 17）：成功后关闭 dialog 并 refresh */
  const handleConfirmDelete = () => {
    if (deleting === null) return;
    const id = deleting.id;
    setDeleting(null);
    void window.api.tags.delete({ id }).then(() => {
      refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-neutral-800">标签</h1>
      {/* 新建行：trim 后提交，成功后清空输入并刷新列表 */}
      <div className="flex items-center gap-2">
        <input
          aria-label="新标签名"
          placeholder="新标签名"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
          className="w-64 rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
        />
        <button
          type="button"
          onClick={handleCreate}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
        >
          新建
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="text-sm text-neutral-400">暂无标签</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700">
              {editingId === tag.id ? (
                <input
                  autoFocus
                  aria-label={`重命名 ${tag.name}`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSubmitRename();
                    } else if (e.key === 'Escape') {
                      // 不冒泡，避免触发容器/窗口级 Esc 处理
                      e.stopPropagation();
                      setEditingId(null);
                    }
                  }}
                  onBlur={handleSubmitRename}
                  className="w-40 rounded-md border border-neutral-200 px-2 py-0.5 text-sm outline-none focus:border-neutral-400"
                />
              ) : (
                /* 实心名称 chip：底色 = tag.color，文字色按底色亮度自动切换 */
                <span className="flex-1">
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                    style={{ backgroundColor: tag.color, color: tagTextColor(tag.color) }}
                  >
                    {tag.name}
                  </span>
                </span>
              )}
              {/* 操作区（任务 17）：行内重命名 + 删除二次确认 */}
              <button
                type="button"
                onClick={() => handleStartRename(tag)}
                className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                重命名
              </button>
              <button
                type="button"
                onClick={() => setDeleting(tag)}
                className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* 删除二次确认（任务 17）：不回溯记录快照，已入库标签文字保留并灰色展示 */}
      <ConfirmDialog
        open={deleting !== null}
        title="确认删除该标签？"
        description="删除后不可恢复。已入库记录将保留该标签文字，展示为灰色。"
        confirmText="确认"
        confirmVariant="destructive"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

export default TagsPage;

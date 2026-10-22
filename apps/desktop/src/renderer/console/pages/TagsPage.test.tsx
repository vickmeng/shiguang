// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Tag } from '@shiguang/shared';
import type { ShiguangApi } from '../../../preload';
import { TagsPage } from './TagsPage';

/** 可变标签库：模拟「写操作成功后 refresh 重拉」的真实链路 */
function createApiMock(initial: Tag[]) {
  let db = [...initial];
  const api = {
    tags: {
      list: vi.fn(() => Promise.resolve([...db])),
      create: vi.fn((payload: { name: string }) => {
        const tag: Tag = { id: db.length + 1, name: payload.name, color: '#f59e0b' };
        db = [...db, tag];
        return Promise.resolve(tag);
      }),
      rename: vi.fn((payload: { id: number; name: string }) => {
        db = db.map((t) => (t.id === payload.id ? { ...t, name: payload.name } : t));
        return Promise.resolve(db.find((t) => t.id === payload.id)!);
      }),
      delete: vi.fn((payload: { id: number }) => {
        db = db.filter((t) => t.id !== payload.id);
        return Promise.resolve();
      }),
      lastGet: vi.fn(() => Promise.resolve([])),
      lastSet: vi.fn(() => Promise.resolve()),
    },
  };
  return { api: api as unknown as ShiguangApi, inner: api };
}

const TWO_TAGS: Tag[] = [
  { id: 1, name: '工作', color: '#f59e0b' },
  { id: 2, name: '灵感', color: '#10b981' },
];

describe('TagsPage 标签维护页', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('挂载即调 tags:list 且列表项名称为实心 chip（底色 = 库色，文字色随亮度）', async () => {
    const { api } = createApiMock([
      { id: 1, name: '工作', color: '#f59e0b' },
      { id: 2, name: '灵感', color: '#10b981' },
    ]);
    window.api = api;
    render(<TagsPage />);

    expect(await screen.findByText('工作')).toBeTruthy();
    expect(screen.getByText('灵感')).toBeTruthy();
    const nameChip = screen.getByText('工作');
    expect(nameChip.className).toContain('rounded-full');
    // jsdom 将 hex 归一化为 rgb；亮底（琥珀）→ 深字
    expect(nameChip.style.backgroundColor).toBe('rgb(245, 158, 11)');
    expect(nameChip.style.color).toBe('rgb(31, 41, 55)');
    expect(api.tags.list).toHaveBeenCalledTimes(1);
  });

  it('输入名称点「新建」：tags:create 以 trim 后名称被调，成功后 input 清空且列表刷新含新项', async () => {
    const user = userEvent.setup();
    const { api, inner } = createApiMock([]);
    window.api = api;
    render(<TagsPage />);

    expect(await screen.findByText('暂无标签')).toBeTruthy();
    const input = screen.getByLabelText('新标签名');
    await user.type(input, '  工作  ');
    await user.click(screen.getByRole('button', { name: '新建' }));

    expect(inner.tags.create).toHaveBeenCalledWith({ name: '工作' });
    expect((input as HTMLInputElement).value).toBe('');
    // refresh 重拉：第二次 list 后新标签入列
    await waitFor(() => expect(inner.tags.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('工作')).toBeTruthy();
    expect(screen.queryByText('暂无标签')).toBeNull();
  });

  it('tags:list 返回空数组时渲染空态文案「暂无标签」', async () => {
    const { api } = createApiMock([]);
    window.api = api;
    render(<TagsPage />);

    expect(await screen.findByText('暂无标签')).toBeTruthy();
    expect(api.tags.list).toHaveBeenCalledTimes(1);
  });

  it('点「重命名」出行内 input，Enter 提交 tags:rename 且 refresh 重拉新名', async () => {
    const user = userEvent.setup();
    const { api, inner } = createApiMock(TWO_TAGS);
    window.api = api;
    render(<TagsPage />);

    const row = (await screen.findByText('工作')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: '重命名' }));

    const editInput = within(row).getByDisplayValue('工作') as HTMLInputElement;
    expect(document.activeElement).toBe(editInput);
    await user.clear(editInput);
    await user.type(editInput, '职场{Enter}');

    expect(inner.tags.rename).toHaveBeenCalledWith({ id: 1, name: '职场' });
    // 成功后 refresh：第二次 list 后列表反映新名
    await waitFor(() => expect(inner.tags.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('职场')).toBeTruthy();
    expect(screen.queryByText('工作')).toBeNull();
  });

  it('编辑中按 Esc 取消：退出编辑且不调 tags:rename', async () => {
    const user = userEvent.setup();
    const { api, inner } = createApiMock(TWO_TAGS);
    window.api = api;
    render(<TagsPage />);

    const row = (await screen.findByText('工作')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: '重命名' }));
    const editInput = within(row).getByDisplayValue('工作');
    await user.type(editInput, 'x{Escape}');

    expect(inner.tags.rename).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('工作x')).toBeNull();
    expect(screen.getByText('工作')).toBeTruthy();
  });

  it('点「删除」出 ConfirmDialog（描述含「灰色」），确认后 tags:delete 被调、dialog 关闭且列表刷新', async () => {
    const user = userEvent.setup();
    const { api, inner } = createApiMock(TWO_TAGS);
    window.api = api;
    render(<TagsPage />);

    const row = (await screen.findByText('灵感')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: '删除' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('确认删除该标签？')).toBeTruthy();
    expect(within(dialog).getByText(/灰色/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: '确认' }));

    expect(inner.tags.delete).toHaveBeenCalledWith({ id: 2 });
    expect(screen.queryByRole('dialog')).toBeNull();
    // 成功后 refresh：被删项消失
    await waitFor(() => expect(inner.tags.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('灵感')).toBeNull();
    expect(screen.getByText('工作')).toBeTruthy();
  });

  it('删除确认框点「取消」：关闭 dialog 且不调 tags:delete', async () => {
    const user = userEvent.setup();
    const { api, inner } = createApiMock(TWO_TAGS);
    window.api = api;
    render(<TagsPage />);

    const row = (await screen.findByText('灵感')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: '删除' }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(inner.tags.delete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(inner.tags.list).toHaveBeenCalledTimes(1);
  });
});

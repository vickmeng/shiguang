// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideNav } from './SideNav';

describe('SideNav 侧边导航', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染三个导航项「记录/标签/设置」，按 records/tags/settings 顺序', () => {
    render(<SideNav selected="records" onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe('记录');
    expect(buttons[1].textContent).toBe('标签');
    expect(buttons[2].textContent).toBe('设置');
  });

  it('点击「标签」回调 onSelect(\'tags\')，选中项高亮', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SideNav selected="records" onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: '标签' }));
    expect(onSelect).toHaveBeenCalledWith('tags');

    cleanup();
    render(<SideNav selected="tags" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: '标签' }).className).toContain(
      'bg-neutral-100',
    );
  });
});

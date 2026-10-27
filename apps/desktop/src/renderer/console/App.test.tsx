// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProfileStatusPayload } from '@shiguang/shared';
import type { ShiguangApi } from '../../preload';
import { App } from './App';

/** App 装配测试只需保证被挂载页能拉到各自数据；具体页内行为归各页测试 */
function createApiMock(): ShiguangApi {
  return {
    capture: {
      list: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      delete: vi.fn(() => Promise.resolve()),
    },
    tags: {
      list: vi.fn(() => Promise.resolve([])),
    },
    profile: {
      get: vi.fn(() =>
        Promise.resolve<ProfileStatusPayload>({
          document: null,
          updatedAt: null,
          pendingCount: 0,
          running: false,
        }),
      ),
      summarize: vi.fn(() => Promise.resolve({ ok: true })),
    },
  } as unknown as ShiguangApi;
}

describe('App console 装配层', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('默认渲染记录页', () => {
    window.api = createApiMock();
    render(<App />);

    expect(screen.getByRole('heading', { name: '记录' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '画像' })).toBeNull();
  });

  it('导航到「画像」渲染 ProfilePage 内容', async () => {
    window.api = createApiMock();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '画像' }));

    expect(screen.getByRole('heading', { name: '画像' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '记录' })).toBeNull();
  });

  it('导航到「标签」渲染 TagsPage 内容', async () => {
    window.api = createApiMock();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '标签' }));

    expect(screen.getByRole('heading', { name: '标签' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '记录' })).toBeNull();
  });

  it('导航到「设置」渲染 SettingsPage 内容', async () => {
    window.api = createApiMock();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '记录' })).toBeNull();
  });
});

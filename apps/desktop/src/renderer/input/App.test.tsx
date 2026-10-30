// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiguangApi } from '../../preload';
import { toast } from '../components/ui/toast';
import { App } from './App';

function createApiMock(): ShiguangApi {
  return {
    capture: {
      create: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      copyImage: vi.fn(),
    },
    tags: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
      lastGet: vi.fn().mockResolvedValue([]),
      lastSet: vi.fn().mockResolvedValue(undefined),
    },
    console: {
      open: vi.fn(),
    },
    profile: {
      get: vi.fn(),
      summarize: vi.fn(),
      history: vi.fn(),
    },
    input: {
      blur: vi.fn(),
      close: vi.fn(),
    },
    pet: {
      clicked: vi.fn(),
      onSetState: vi.fn(() => () => {}),
    },
  };
}

describe('App 输入框窗口', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('点击右上角关闭按钮调用 input.close()', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    render(<App />);

    await user.click(screen.getByRole('button', { name: '关闭' }));

    expect(api.input.close).toHaveBeenCalledTimes(1);
  });

  it('点击「打开后台」按钮调用 console.open()', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    render(<App />);

    await user.click(screen.getByRole('button', { name: '打开后台' }));

    expect(api.console.open).toHaveBeenCalledTimes(1);
  });

  it('根部挂载 Toaster：toast() 推送后渲染提示容器', () => {
    const api = createApiMock();
    window.api = api;
    render(<App />);

    act(() => {
      toast('提示内容');
    });

    expect(screen.getByRole('status').textContent).toBe('提示内容');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiguangApi } from '../../preload';
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
});

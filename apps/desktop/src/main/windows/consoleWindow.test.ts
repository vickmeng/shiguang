/**
 * consoleWindow 单测（AC-12）：覆盖窗口幂等状态机多分支——
 * 首次创建并 show+focus；已存在未销毁且未最小化时 focus 复用；
 * 已最小化时 restore+focus；`closed` 事件后清引用、再次调用可重建；
 * 另覆盖右键 contextmenu 触发 toggleDevTools（AC-11 的胶水接线，
 * 手动走查为主，此处仅断言接线成立）。
 *
 * BrowserWindow 用 mock 类替代（不加载真实 Electron 原生模块），
 * app 仅提供 getAppPath。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { MockBrowserWindow, electronMock } = vi.hoisted(() => {
  class MockWebContents {
    toggleDevTools = vi.fn();
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    on(channel: string, callback: (...args: unknown[]) => void): void {
      const list = this.listeners.get(channel) ?? [];
      list.push(callback);
      this.listeners.set(channel, list);
    }

    /** 测试辅助：向 webContents 派发事件（如 'context-menu'） */
    emit(channel: string): void {
      for (const cb of this.listeners.get(channel) ?? []) cb();
    }
  }

  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];

    webContents = new MockWebContents();
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    loadURL = vi.fn().mockResolvedValue(undefined);
    loadFile = vi.fn().mockResolvedValue(undefined);

    minimized = false;
    private destroyed = false;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(public readonly options: Record<string, unknown>) {
      MockBrowserWindow.instances.push(this);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isMinimized(): boolean {
      return this.minimized;
    }

    on(channel: string, callback: (...args: unknown[]) => void): void {
      const list = this.listeners.get(channel) ?? [];
      list.push(callback);
      this.listeners.set(channel, list);
    }

    /** 测试辅助：模拟用户关闭窗口（Cmd+W），置 destroyed 并派发 'closed' */
    emitClosed(): void {
      this.destroyed = true;
      for (const cb of this.listeners.get('closed') ?? []) cb();
    }
  }

  return {
    MockBrowserWindow,
    electronMock: {
      BrowserWindow: MockBrowserWindow,
      app: { getAppPath: () => '/mock-app-path' },
    },
  };
});

vi.mock('electron', () => electronMock);

import { openConsoleWindow } from './consoleWindow';

type MockWin = InstanceType<typeof MockBrowserWindow>;
/** openConsoleWindow 返回类型标注为 electron BrowserWindow，测试中断言 mock 专属面时做窄化 */
const asMockWin = (win: unknown): MockWin => win as MockWin;

describe('openConsoleWindow 幂等状态机', () => {
  beforeEach(() => {
    MockBrowserWindow.instances.length = 0;
    delete process.env['ELECTRON_RENDERER_URL'];
  });

  afterEach(() => {
    // 清掉模块级引用，避免用例间泄漏窗口单例
    MockBrowserWindow.instances.at(-1)?.emitClosed();
  });

  it('首次调用创建 BrowserWindow（show:false）并 show+focus，加载打包产物路径', () => {
    const win = asMockWin(openConsoleWindow());

    expect(MockBrowserWindow.instances).toHaveLength(1);
    expect(win).toBe(MockBrowserWindow.instances[0]);
    expect(win.options['show']).toBe(false);
    expect(win.options['width']).toBe(960);
    expect(win.options['height']).toBe(640);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.restore).not.toHaveBeenCalled();
    // 无 dev server 环境变量时走 loadFile
    expect(win.loadFile).toHaveBeenCalledWith(
      '/mock-app-path/out/renderer/console/console.html',
    );
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it('开发态（ELECTRON_RENDERER_URL 存在）改走 loadURL', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';

    const win = asMockWin(openConsoleWindow());

    expect(win.loadURL).toHaveBeenCalledWith(
      'http://localhost:5173/console/console.html',
    );
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it('已存在未销毁且未最小化时：不新建窗口，直接 focus 复用', () => {
    const first = asMockWin(openConsoleWindow());
    first.show.mockClear();
    first.focus.mockClear();

    const second = asMockWin(openConsoleWindow());

    expect(MockBrowserWindow.instances).toHaveLength(1);
    expect(second).toBe(first);
    expect(first.restore).not.toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(first.show).not.toHaveBeenCalled();
  });

  it('已存在但处于最小化时：restore 后再 focus，不新建窗口', () => {
    const first = asMockWin(openConsoleWindow());
    first.minimized = true;
    first.focus.mockClear();

    const second = asMockWin(openConsoleWindow());

    expect(MockBrowserWindow.instances).toHaveLength(1);
    expect(second).toBe(first);
    expect(first.restore).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
  });

  it('closed 事件后清空引用：再次调用创建全新窗口并 show+focus', () => {
    const first = asMockWin(openConsoleWindow());
    first.emitClosed();

    const second = asMockWin(openConsoleWindow());

    expect(MockBrowserWindow.instances).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(second.show).toHaveBeenCalledTimes(1);
    expect(second.focus).toHaveBeenCalledTimes(1);
  });

  it('窗口已销毁（外部途径）时同样视为不存在，直接重建', () => {
    const first = asMockWin(openConsoleWindow());
    // 不经 closed 回调、仅置 destroyed（模拟异常路径）
    first.emitClosed();

    openConsoleWindow();

    expect(MockBrowserWindow.instances).toHaveLength(2);
  });

  it('右键 context-menu 触发 webContents.toggleDevTools（AC-11 接线断言）', () => {
    const win = asMockWin(openConsoleWindow());

    win.webContents.emit('context-menu');

    expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
  });
});

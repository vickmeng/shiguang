/**
 * consoleHandlers 单测（AC-12）：验证 `console:open` 通道注册——
 * 使用 shared 常量通道（IPC.consoleOpen），收到事件时调用 openConsoleWindow()。
 * openConsoleWindow 以模块 mock 隔离，不断言其内部行为（由 consoleWindow.test.ts 覆盖）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IPC } from '@shiguang/shared';

const { ipcMainMock, openConsoleWindowMock } = vi.hoisted(() => ({
  ipcMainMock: {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  openConsoleWindowMock: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: ipcMainMock }));
vi.mock('../windows/consoleWindow', () => ({
  openConsoleWindow: openConsoleWindowMock,
}));

import { registerConsoleHandlers } from './consoleHandlers';

describe('registerConsoleHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('使用 shared 常量通道 IPC.consoleOpen 注册 on 监听，并先清旧监听', () => {
    registerConsoleHandlers();

    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IPC.consoleOpen);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith('console:open');
    expect(ipcMainMock.on).toHaveBeenCalledTimes(1);
    expect(ipcMainMock.on.mock.calls[0]![0]).toBe(IPC.consoleOpen);
  });

  it('收到 console:open 事件时调用 openConsoleWindow()', () => {
    registerConsoleHandlers();
    const listener = ipcMainMock.on.mock.calls[0]![1] as () => void;

    listener();

    expect(openConsoleWindowMock).toHaveBeenCalledTimes(1);
  });

  it('多次注册不产生重复监听（先 removeAllListeners 再 on）', () => {
    registerConsoleHandlers();
    registerConsoleHandlers();

    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledTimes(2);
    expect(ipcMainMock.on).toHaveBeenCalledTimes(2);
    // 每次注册仅注册一个 on 监听；触发最新一次注册的回调即可开窗
    const listener = ipcMainMock.on.mock.calls.at(-1)![1] as () => void;
    listener();
    expect(openConsoleWindowMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * 后台窗口唤起相关 IPC handler 注册。
 *
 * `console:open` 由渲染端（输入框「打开后台」按钮）发出，主进程收到后
 * 幂等唤起后台管理窗口。由 registerIpc 统一装配。
 */
import { ipcMain } from 'electron';
import { IPC } from '@shiguang/shared';
import { openConsoleWindow } from '../windows/consoleWindow';

/** 注册 `console:open` 通道：收到后打开（或聚焦）后台管理窗口。 */
export function registerConsoleHandlers(): void {
  ipcMain.removeAllListeners(IPC.consoleOpen);
  ipcMain.on(IPC.consoleOpen, () => {
    openConsoleWindow();
  });
}

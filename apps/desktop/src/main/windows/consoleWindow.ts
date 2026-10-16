/**
 * 后台管理窗口（AC-1、AC-2）。
 *
 * 普通系统窗口（frame 保留、resizable、不出现在悬浮层上方）：承载记录台 /
 * 设置页等后台管理界面。与宠物/输入框悬浮窗不同，本窗口是标准应用窗口
 * （Dock 可见、任务栏可见），不随 app ready 创建，由 `console:open` IPC
 * 或渲染端「打开后台」按钮按需唤起。
 *
 * 幂等语义与 petWindow/inputWindow 一致：已存在且未销毁则 focus+restore
 * 复用，`closed` 事件清空模块引用允许下次重建。
 *
 * 窗口行为以手动走查为主（AC-2），双击标题栏缩放、resizable 等观感细节
 * 不在本模块做代码级断言。
 */
import path from 'node:path';
import { BrowserWindow, app } from 'electron';

/** 后台窗口内容尺寸（resizable 普通窗口，960×640 起步） */
const CONSOLE_WIDTH = 960;
const CONSOLE_HEIGHT = 640;

let consoleWindow: BrowserWindow | null = null;

/**
 * 打开后台管理窗口（幂等）：已存在且未销毁则聚焦复用，否则创建新窗口。
 */
export function openConsoleWindow(): BrowserWindow {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    if (consoleWindow.isMinimized()) consoleWindow.restore();
    consoleWindow.focus();
    return consoleWindow;
  }

  consoleWindow = new BrowserWindow({
    width: CONSOLE_WIDTH,
    height: CONSOLE_HEIGHT,
    resizable: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      // electron-vite 打包的 cjs preload 产物在 out/preload/（主进程在 out/main/）
      preload: path.join(__dirname, '../preload/index.js'),
      // cjs preload 在无沙箱下最稳，避免沙箱 polyfill 与打包产物兼容问题
      sandbox: false,
    },
  });

  // 右键 contextmenu 唤出/关闭开发者工具（仅后台窗口，AC-11）
  consoleWindow.webContents.on('context-menu', () => {
    consoleWindow?.webContents.toggleDevTools();
  });

  // 用户关掉后台窗口（如 Cmd+W）时清空引用，允许下次重建
  consoleWindow.on('closed', () => {
    consoleWindow = null;
  });

  consoleWindow.show();
  consoleWindow.focus();

  // 开发态走 vite dev server；打包态加载 out/renderer/console/console.html
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void consoleWindow.loadURL(`${devServerUrl}/console/console.html`);
  } else {
    void consoleWindow.loadFile(
      path.join(app.getAppPath(), 'out', 'renderer', 'console', 'console.html'),
    );
  }

  return consoleWindow;
}

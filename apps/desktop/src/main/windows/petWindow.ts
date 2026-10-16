/**
 * 宠物悬浮窗。
 *
 * frameless + transparent + alwaysOnTop 的 128×104 悬浮层，承载 Hooper idle
 * 动效（渲染端 PixiJS）。默认定位主屏工作区右下角（留边距不贴 Dock，
 * 位置由 computePetPosition 计算，不持久化）。
 *
 * 单击事件由渲染端经 `pet:clicked` 上报；本模块只做转发——inputWindow
 * 通过 onPetClicked(cb) 注册显隐协调回调（blur 抑制 + toggle 逻辑在
 * inputWindow 内，见 blurSuppress.ts）。
 *
 * 拖动由渲染端 CSS `-webkit-app-region: drag` 实现，本文件不含拖动逻辑。
 */
import path from 'node:path';
import { BrowserWindow, ipcMain, screen, app } from 'electron';
import { IPC } from '@shiguang/shared';
import { computePetPosition } from '../lib/windowGeometry';

/** 宠物窗口内容尺寸（精灵图 256×208 经 0.5 缩放） */
const PET_WIDTH = 128;
const PET_HEIGHT = 104;

/** 距屏幕工作区边缘的留白，避免贴边/贴 Dock */
const SCREEN_MARGIN = 12;

let petWindow: BrowserWindow | null = null;

/** inputWindow 注册的 pet:clicked 协调回调列表 */
const petClickedListeners = new Set<() => void>();

/**
 * 注册宠物单击协调回调（inputWindow 用），返回取消注册函数。
 */
export function onPetClicked(cb: () => void): () => void {
  petClickedListeners.add(cb);
  return () => {
    petClickedListeners.delete(cb);
  };
}

/**
 * 获取宠物窗口实例（inputWindow 定位输入框时读取宠物边界用）。
 */
export function getPetWindow(): BrowserWindow | null {
  return petWindow;
}

/**
 * 创建宠物悬浮窗并定位到主屏工作区右下角。
 * 重复调用返回既有实例（幂等）。
 */
export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;

  const workArea = screen.getPrimaryDisplay().workArea;
  const { x, y } = computePetPosition(workArea, SCREEN_MARGIN);

  petWindow = new BrowserWindow({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x,
    y,
    webPreferences: {
      // 宠物页透明底，禁用上下文菜单与缩放更符合悬浮宠物观感
      contextIsolation: true,
      // electron-vite 打包的 cjs preload 产物在 out/preload/（主进程在 out/main/）
      preload: path.join(__dirname, '../preload/index.js'),
      // cjs preload 在无沙箱下最稳，避免沙箱 polyfill 与打包产物兼容问题
      sandbox: false,
    },
  });

  // 用户关掉宠物窗口（如 Cmd+W 兜底）时清空引用，允许下次重建
  petWindow.on('closed', () => {
    petWindow = null;
  });

  // 渲染端点击（未拖动）上报 pet:clicked → 转发给注册的协调回调
  ipcMain.removeAllListeners(IPC.petClicked);
  ipcMain.on(IPC.petClicked, () => {
    for (const cb of petClickedListeners) cb();
  });

  // 开发态走 vite dev server；打包态加载 out/renderer/pet/pet.html
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void petWindow.loadURL(`${devServerUrl}/pet/pet.html`);
  } else {
    void petWindow.loadFile(
      path.join(app.getAppPath(), 'out', 'renderer', 'pet', 'pet.html'),
    );
  }

  return petWindow;
}

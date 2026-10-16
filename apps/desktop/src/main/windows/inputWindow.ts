/**
 * 输入框悬浮窗 + 显隐协调状态机（AC-3、AC-8）。
 *
 * frameless + transparent + alwaysOnTop 的 360px 宽小浮窗，主进程集中管理
 * 显隐：宠物窗口 focusable:false 不接受焦点，输入框是唯一可聚焦窗口。
 *
 * 显隐时序：
 * - 输入框 blur（或渲染端上报 input:blur）→ 收起，并记
 *   suppressUntil = nextSuppressUntil(Date.now())，此后 300ms 内的
 *   pet:clicked 被忽略（防「点空白收起 → 同一次点击穿透到宠物又打开」闪振）。
 * - 渲染端反馈完成后上报 input:close（如「✓ 已拾光」结束）→ 直接收起，不做抑制。
 * - pet:clicked 到达：抑制窗口内忽略；否则 toggle——可见则收起，隐藏则经
 *   computeInputPosition 定位到宠物旁（默认左侧，空间不足翻到右侧）再显示并聚焦。
 *
 * 窗口状态机行为以手动验收为主（AC-3 走查），blur 抑制纯逻辑见 blurSuppress.ts。
 */
import path from 'node:path';
import { BrowserWindow, ipcMain, screen, app } from 'electron';
import { IPC } from '@shiguang/shared';
import { computeInputPosition } from '../lib/windowGeometry';
import { nextSuppressUntil, shouldSuppressPetClick } from '../lib/blurSuppress';
import { getPetWindow, onPetClicked } from './petWindow';

/** 输入框窗口尺寸（resizable:false，定高浮窗；宽 360 为设计约定） */
const INPUT_WIDTH = 360;
const INPUT_HEIGHT = 320;

/** 输入框与宠物窗口之间的横向间距 */
const PET_GAP = 12;

/** 宠物窗口尺寸（与 petWindow.ts / windowGeometry.ts 保持一致，仅作兜底） */
const PET_WIDTH = 128;
const PET_HEIGHT = 104;
const SCREEN_MARGIN = 12;

let inputWindow: BrowserWindow | null = null;

/** blur 抑制截止时间戳：收起时更新，300ms 内忽略 pet:clicked */
let suppressUntil = 0;

function hide(): void {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.hide();
  }
}

/** 收起并进入 300ms 抑制窗口（blur 路径，防同一次点击穿透回宠物） */
function hideWithSuppress(): void {
  suppressUntil = nextSuppressUntil(Date.now());
  hide();
}

/** 定位到宠物旁并显示、聚焦 */
function showNearPet(): void {
  const win = inputWindow;
  if (!win || win.isDestroyed()) return;

  const workArea = screen.getPrimaryDisplay().workArea;

  // 宠物窗口可能尚未创建或已被关闭，兜底用其默认右下角位置
  const pet = getPetWindow();
  const petBounds =
    pet && !pet.isDestroyed()
      ? pet.getBounds()
      : {
          x: workArea.x + workArea.width - PET_WIDTH - SCREEN_MARGIN,
          y: workArea.y + workArea.height - PET_HEIGHT - SCREEN_MARGIN,
          width: PET_WIDTH,
          height: PET_HEIGHT,
        };

  const { x, y } = computeInputPosition(
    petBounds,
    { width: INPUT_WIDTH, height: INPUT_HEIGHT },
    workArea,
    PET_GAP,
  );
  win.setBounds({ x, y, width: INPUT_WIDTH, height: INPUT_HEIGHT });
  win.show();
  win.focus();
}

/** pet:clicked 协调：抑制窗口内忽略，否则 toggle */
function toggleFromPetClick(): void {
  if (!inputWindow || inputWindow.isDestroyed()) return;
  if (inputWindow.isVisible()) {
    hide();
    return;
  }
  showNearPet();
}

// 注册宠物单击协调回调：blur 抑制判定 + toggle
onPetClicked(() => {
  if (shouldSuppressPetClick(suppressUntil, Date.now())) return;
  toggleFromPetClick();
});

/**
 * 注册输入框窗口的渲染端 IPC 收起通道（input:blur / input:close）。
 * 由 registerIpc 统一装配，createInputWindow 不再出现 ipcMain。
 */
export function registerInputWindowIpc(): void {
  // 渲染端 textarea blur 兜底（与原生 blur 事件同路径，带抑制）
  ipcMain.removeAllListeners(IPC.inputBlur);
  ipcMain.on(IPC.inputBlur, hideWithSuppress);

  // 渲染端反馈完成后主动收起（如「✓ 已拾光」结束）：直接收起，不做抑制
  ipcMain.removeAllListeners(IPC.inputClose);
  ipcMain.on(IPC.inputClose, hide);
}

/**
 * 创建输入框窗口（初始隐藏），并接线 blur / input:blur / input:close 收起路径。
 * 重复调用返回既有实例（幂等）。
 */
export function createInputWindow(): BrowserWindow {
  if (inputWindow && !inputWindow.isDestroyed()) return inputWindow;

  inputWindow = new BrowserWindow({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    width: INPUT_WIDTH,
    height: INPUT_HEIGHT,
    show: false,
    webPreferences: {
      contextIsolation: true,
      // electron-vite 打包的 cjs preload 产物在 out/preload/（主进程在 out/main/）
      preload: path.join(__dirname, '../preload/index.js'),
      // cjs preload 在无沙箱下最稳，避免沙箱 polyfill 与打包产物兼容问题
      sandbox: false,
    },
  });

  // 用户关掉输入框窗口（如 Cmd+W 兜底）时清空引用，允许下次重建
  inputWindow.on('closed', () => {
    inputWindow = null;
  });

  // 失焦即收起并进入抑制窗口（AC-3 blur 路径）
  inputWindow.on('blur', hideWithSuppress);

  // 开发态走 vite dev server；打包态加载 out/renderer/input/input.html
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void inputWindow.loadURL(`${devServerUrl}/input/input.html`);
  } else {
    void inputWindow.loadFile(
      path.join(app.getAppPath(), 'out', 'renderer', 'input', 'input.html'),
    );
  }

  return inputWindow;
}

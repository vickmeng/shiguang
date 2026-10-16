/**
 * 系统托盘。
 *
 * 拾光主窗口为无 Dock 图标的宠物悬浮窗，退出入口收敛到托盘菜单（AC-4）。
 * 菜单目前仅一项「退出」，后续迭代按需扩充（如「显示输入框」「关于」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';

// 模块级引用，防止 Tray 被 GC 回收后菜单消失。
let tray: Tray | null = null;

// 图标候选路径：electron-builder 打包后静态资源位于 process.resourcesPath
// （需在 electron-builder.yml 配 extraResources 才会真正存在）；开发态回退到
// 仓库内 apps/desktop/resources/icons。两者都不存在时以内嵌 PNG 兜底，
// 替换正式图标资源后兜底分支可删除。
const TRAY_ICON_CANDIDATES = [
  path.join(process.resourcesPath, 'icons', 'trayTemplate.png'),
  path.join(app.getAppPath(), 'resources', 'icons', 'trayTemplate.png'),
];

// 16×16 橙色圆点占位图标（拾光主色近似 #F97316，抗锯齿透明底），后续替换正式托盘图标。
// 注意：历史内嵌的 base64 数据损坏（IDAT 无法解压导致 nativeImage 为空、托盘无图标），
// 替换时务必用真实 PNG 文件重新编码。
const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAbklEQVR4nGP4WSzGQAnGJcH5s1gs5GexWDUUh0DFiDIApOHLz2Kx/2j4C1QOrwGLsGhEx4twGVBNhGYYrkY3gBOHs3HhL7AwgRkQQoJmGA5BNoAU56N4g2oGUOwFigOR4mikSkKiSlKmSmYiCQMA8csGb+bHePUAAAAASUVORK5CYII=';

function resolveTrayIcon(): Electron.NativeImage {
  for (const candidate of TRAY_ICON_CANDIDATES) {
    if (fs.existsSync(candidate)) return nativeImage.createFromPath(candidate);
  }
  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

export function createTray(): Tray {
  tray = new Tray(resolveTrayIcon());
  tray.setToolTip('拾光');
  tray.setContextMenu(
    Menu.buildFromTemplate([{ label: '退出', click: () => app.quit() }]),
  );
  return tray;
}

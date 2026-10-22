/**
 * 拾光主进程入口。
 *
 * 启动顺序：dotenv → 数据库初始化 → 窗口装配。
 * M1 装配：app ready 后隐藏 Dock，依次创建宠物悬浮窗（右下角 idle）、
 * 系统托盘（退出入口）、注册 IPC handler、创建输入框窗口（初始隐藏，
 * 由宠物单击经显隐协调状态机唤出）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { app } from 'electron';
import { initDatabase, setCaptureDatabase, setTagDatabase } from '@shiguang/ai';
import { createPetWindow } from './windows/petWindow';
import { createInputWindow } from './windows/inputWindow';
import { createTray } from './tray';
import { registerIpc } from './ipc/registerIpc';
import { registerImageProtocol } from './screenshot/imageProtocol';

// 1. 加载环境变量（仓库根 .env；KIMI_API_KEY 为分析阶段占位）
// dotenv 默认取 process.cwd() 下的 .env，而 pnpm --filter 启动时 cwd 是 apps/desktop，
// 与仓库根 .env.example 的约定不一致；这里从 app.getAppPath() 向上查找仓库根 .env。
function findRootEnv(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const rootEnvPath = findRootEnv(app.getAppPath());
if (rootEnvPath) loadEnv({ path: rootEnvPath });

// 2. 初始化数据库并注入 captureDao/tagDao 连接（单一 SQLite 文件：userData/shiguang.db，
// 同一连接注入两个 DAO，initDatabase 仅调用一次）
// app.getPath('userData') 在 app ready 前可用
const dbPath = path.join(app.getPath('userData'), 'shiguang.db');
const db = initDatabase(dbPath);
setCaptureDatabase(db);
setTagDatabase(db);

// 3. app ready 后装配 M1 窗口：
// 图片协议（须早于窗口创建，渲染端 <img> 才能走 shiguang-image://）
// → 宠物 → 托盘 → IPC → 输入框（隐藏态，由 pet:clicked 显隐协调唤出）。
// 调试期暂不隐藏 Dock 图标，便于聚焦应用排查问题；稳定后恢复 app.dock?.hide()。
app.whenReady().then(() => {
  registerImageProtocol();
  createPetWindow();
  createTray();
  registerIpc();
  createInputWindow();

  console.log(`[shiguang] main process started, db: ${dbPath}`);
});

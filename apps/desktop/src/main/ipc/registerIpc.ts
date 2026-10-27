/**
 * 主进程 IPC 注册汇总。
 *
 * 各 handler 模块只导出「注册函数」，本函数在 app ready 后调用一次，
 * 集中装配所有 ipcMain 通道。
 */
import { registerCaptureHandlers } from './captureHandlers';
import { registerConsoleHandlers } from './consoleHandlers';
import { registerProfileHandlers } from './profileHandlers';
import { registerTagsHandlers } from './tagsHandlers';
import { registerInputWindowIpc } from '../windows/inputWindow';
import { registerPetWindowIpc } from '../windows/petWindow';

/** 汇总注册全部 IPC handler。 */
export function registerIpc(): void {
  registerCaptureHandlers();
  registerTagsHandlers();
  registerProfileHandlers();
  registerConsoleHandlers();
  registerPetWindowIpc();
  registerInputWindowIpc();
}

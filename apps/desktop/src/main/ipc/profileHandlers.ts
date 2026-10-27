/**
 * 画像相关 IPC handler 注册（AC-2、AC-7）。
 *
 * 两通道与底层一一对应、零编排：
 *  - profile:get       → ProfileStatusPayload：document/updatedAt 取自
 *                        profileDao.getProfile（无画像行时为 null），
 *                        pendingCount 取自 profileDao.pendingCount，
 *                        running 取自 profileRunner.isRunning（画像页据此
 *                        禁用「立即汇总」按钮）
 *  - profile:summarize → summarizeNow()（resolve 值原样透出；running 中
 *                        幂等返回 { ok: true }，失败返回 { ok: false, error }，
 *                        单飞语义由 profileRunner 保证）
 *
 * DAO 与 runner 抛错即自然 reject invoke，渲染侧 catch 提示。
 */
import { ipcMain } from 'electron';
import { IPC } from '@shiguang/shared';
import type { ProfileStatusPayload } from '@shiguang/shared';
import { getProfile, pendingCount } from '@shiguang/ai';
import { isRunning, summarizeNow } from '../profile/profileRunner';

/** 注册画像相关 IPC 通道：状态查询 + 手动汇总。 */
export function registerProfileHandlers(): void {
  ipcMain.handle(IPC.profileGet, () => {
    const row = getProfile();
    return {
      document: row?.document ?? null,
      updatedAt: row?.updatedAt ?? null,
      pendingCount: pendingCount(),
      running: isRunning(),
    } satisfies ProfileStatusPayload;
  });
  ipcMain.handle(IPC.profileSummarize, () => summarizeNow());
}

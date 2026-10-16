/**
 * 渲染进程全局类型声明：preload 通过 contextBridge 暴露的 `window.api`。
 */
import type { ShiguangApi } from '../preload';

declare global {
  interface Window {
    api: ShiguangApi;
  }
}

export {};

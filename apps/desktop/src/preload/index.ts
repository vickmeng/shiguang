/**
 * preload 脚本：通过 contextBridge 向渲染进程暴露类型化 `window.api`。
 *
 * 关键契约：本文件只依赖 `packages/shared` 的类型与通道常量，
 * 不依赖任何主进程实现文件（主进程 handler 由任务 12 注册）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type CaptureRecord,
  type CopyImagePayload,
  type CreateCapturePayload,
  type DeleteCapturesPayload,
  type QueryCapturesPayload,
  type QueryCapturesResult,
} from '@shiguang/shared';

/** 暴露给渲染进程的 API 形状（env.d.ts 中声明为 window.api 的全局类型） */
export interface ShiguangApi {
  capture: {
    /** 创建一条纯文字捕获记录，返回已入库记录 */
    create(payload: CreateCapturePayload): Promise<CaptureRecord>;
    /** 分页查询捕获记录（关键词/时间筛选 + 倒序） */
    list(payload: QueryCapturesPayload): Promise<QueryCapturesResult>;
    /** 批量删除捕获记录 */
    delete(payload: DeleteCapturesPayload): Promise<void>;
    /** 将图片记录复制到系统剪贴板（非图片记录或文件缺失时 reject） */
    copyImage(payload: CopyImagePayload): Promise<void>;
  };
  console: {
    /** 打开（或聚焦）后台管理窗口 */
    open(): void;
  };
  input: {
    /** 输入框失焦：通知主进程收起窗口并进入 300ms 点击抑制 */
    blur(): void;
    /** 请求关闭（收起）输入框窗口 */
    close(): void;
  };
  pet: {
    /** 宠物被单击：请求主进程 toggle 输入框 */
    clicked(): void;
    /**
     * 订阅主进程下发的宠物状态切换（M1 预留口子，主端暂不发送）。
     * 返回取消订阅函数。
     */
    onSetState(cb: (state: string) => void): () => void;
  };
}

const api: ShiguangApi = {
  capture: {
    create: (payload) => ipcRenderer.invoke(IPC.captureCreate, payload),
    list: (payload) => ipcRenderer.invoke(IPC.captureList, payload),
    delete: (payload) => ipcRenderer.invoke(IPC.captureDelete, payload),
    copyImage: (payload) => ipcRenderer.invoke(IPC.captureCopyImage, payload),
  },
  console: {
    open: () => ipcRenderer.send(IPC.consoleOpen),
  },
  input: {
    blur: () => ipcRenderer.send(IPC.inputBlur),
    close: () => ipcRenderer.send(IPC.inputClose),
  },
  pet: {
    clicked: () => ipcRenderer.send(IPC.petClicked),
    onSetState: (cb) => {
      const listener = (_event: Electron.IpcRendererEvent, state: string): void => cb(state);
      ipcRenderer.on(IPC.petSetState, listener);
      return () => {
        ipcRenderer.removeListener(IPC.petSetState, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

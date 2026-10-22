/**
 * tagsHandlers 单测：验证标签系统六条 IPC 通道的胶水转发契约
 * （REQ-TAG-01~04 / AC-2、AC-3、AC-4）。
 *
 * 六通道与底层一一对应、零编排：
 *  - tags:list     → listTags()
 *  - tags:create   → createTag(payload)（payload 原样透传，DAO 内含
 *                    trim / 1~20 字校验 / 重名转选中；DAO 抛错自然 reject invoke）
 *  - tags:rename   → renameTag(payload)（payload 原样透传）
 *  - tags:delete   → deleteTag(payload) 后 resolve undefined
 *  - tags:lastGet  → getLastTags()
 *  - tags:lastSet  → setLastTags(payload.names)（取 .names，不整包透传）
 *
 * mock electron 的 ipcMain（handle 捕获注册）与 @shiguang/ai 的
 * tagDao 四函数、../tags/tagMemoryStore 的两函数（DAO/store 真行为分别由
 * tagDao.test.ts 与 tagMemoryStore.test.ts 覆盖），只断言本层的
 * 「通道存在 + 调用对应函数 + 参数形态」。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IPC } from '@shiguang/shared';
import type {
  CreateTagPayload,
  DeleteTagPayload,
  RenameTagPayload,
  SetLastTagsPayload,
  Tag,
} from '@shiguang/shared';

const { stubs, store } = vi.hoisted(() => ({
  stubs: {
    ipcMain: {
      removeAllListeners: vi.fn(),
      on: vi.fn(),
      handle: vi.fn(),
    },
    listTags: vi.fn(),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
  },
  store: {
    getLastTags: vi.fn(),
    setLastTags: vi.fn(),
  },
}));

vi.mock('electron', () => ({ ipcMain: stubs.ipcMain }));
vi.mock('@shiguang/ai', () => ({
  listTags: stubs.listTags,
  createTag: stubs.createTag,
  renameTag: stubs.renameTag,
  deleteTag: stubs.deleteTag,
}));
vi.mock('../tags/tagMemoryStore', () => ({
  getLastTags: store.getLastTags,
  setLastTags: store.setLastTags,
}));

import { registerTagsHandlers } from './tagsHandlers';

const TAG: Tag = { id: 1, name: '工作', color: '#f59e0b' };

/** 取出指定通道的 invoke handler（先注册再捕获）。 */
function handlerOf<T extends unknown[], R>(channel: string): (...args: T) => R {
  registerTagsHandlers();
  const call = stubs.ipcMain.handle.mock.calls.find((c) => c[0] === channel);
  expect(call, `通道 ${channel} 应注册`).toBeDefined();
  return call![1] as (...args: T) => R;
}

describe('tagsHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('六通道全部注册（tags:list / create / rename / delete / lastGet / lastSet）', () => {
    registerTagsHandlers();
    const channels = stubs.ipcMain.handle.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        IPC.tagsList,
        IPC.tagsCreate,
        IPC.tagsRename,
        IPC.tagsDelete,
        IPC.tagsLastGet,
        IPC.tagsLastSet,
      ]),
    );
  });

  it('tags:list → listTags()', async () => {
    stubs.listTags.mockReturnValue([TAG]);
    const handler = handlerOf<[unknown], Tag[]>(IPC.tagsList);

    await expect(handler({})).resolves.toEqual([TAG]);
    expect(stubs.listTags).toHaveBeenCalledTimes(1);
    expect(stubs.listTags).toHaveBeenCalledWith();
  });

  it('tags:create → createTag(payload)，payload 原样透传', async () => {
    stubs.createTag.mockReturnValue(TAG);
    const payload: CreateTagPayload = { name: '  工作  ' };
    const handler = handlerOf<[unknown, CreateTagPayload], Tag>(IPC.tagsCreate);

    await expect(handler({}, payload)).resolves.toEqual(TAG);
    expect(stubs.createTag).toHaveBeenCalledWith(payload);
  });

  it('tags:create 名称违规（DAO 抛错）：invoke 自然 reject', async () => {
    stubs.createTag.mockImplementation(() => {
      throw new Error('标签名需为 1~20 字');
    });
    const handler = handlerOf<[unknown, CreateTagPayload], Tag>(IPC.tagsCreate);

    await expect(handler({}, { name: '' })).rejects.toThrow('标签名需为 1~20 字');
  });

  it('tags:rename → renameTag(payload)，payload 原样透传', async () => {
    const renamed: Tag = { ...TAG, name: '学习' };
    stubs.renameTag.mockReturnValue(renamed);
    const payload: RenameTagPayload = { id: 1, name: '学习' };
    const handler = handlerOf<[unknown, RenameTagPayload], Tag>(IPC.tagsRename);

    await expect(handler({}, payload)).resolves.toEqual(renamed);
    expect(stubs.renameTag).toHaveBeenCalledWith(payload);
  });

  it('tags:delete → deleteTag(payload)，resolve 值为 undefined', async () => {
    stubs.deleteTag.mockReturnValue(undefined);
    const payload: DeleteTagPayload = { id: 1 };
    const handler = handlerOf<[unknown, DeleteTagPayload], void>(IPC.tagsDelete);

    await expect(handler({}, payload)).resolves.toBeUndefined();
    expect(stubs.deleteTag).toHaveBeenCalledWith(payload);
  });

  it('tags:lastGet → getLastTags()', async () => {
    store.getLastTags.mockReturnValue(['工作', '灵感']);
    const handler = handlerOf<[unknown], string[]>(IPC.tagsLastGet);

    await expect(handler({})).resolves.toEqual(['工作', '灵感']);
    expect(store.getLastTags).toHaveBeenCalledTimes(1);
  });

  it('tags:lastSet → setLastTags(payload.names)（取 names 字段，不整包透传）', async () => {
    store.setLastTags.mockReturnValue(undefined);
    const payload: SetLastTagsPayload = { names: ['工作', '灵感'] };
    const handler = handlerOf<[unknown, SetLastTagsPayload], void>(IPC.tagsLastSet);

    await expect(handler({}, payload)).resolves.toBeUndefined();
    expect(store.setLastTags).toHaveBeenCalledWith(['工作', '灵感']);
  });
});

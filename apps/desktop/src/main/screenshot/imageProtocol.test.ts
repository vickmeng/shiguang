/**
 * imageProtocol 单测（AC-6、AC-10）：验证 `shiguang-image://` 协议注册与响应逻辑——
 * 仅服务 userData/images 根内的 .png 文件（isSubPath 防目录穿越 + 存在性校验），
 * 其余一律 404 空 Response。electron 的 protocol/net/app 与 node:fs 的 existsSync 以模块 mock 隔离。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userDataDir = path.resolve('/tmp/shiguang-test-userdata');
const imagesDir = path.join(userDataDir, 'images');

const { protocolMock, netMock, appMock, existsSyncMock } = vi.hoisted(() => ({
  protocolMock: { handle: vi.fn() },
  netMock: { fetch: vi.fn() },
  appMock: { getPath: vi.fn(() => '/tmp/shiguang-test-userdata') },
  existsSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
  protocol: protocolMock,
  net: netMock,
  app: appMock,
}));
vi.mock('node:fs', () => ({ existsSync: existsSyncMock }));

import { registerImageProtocol } from './imageProtocol';

type Handler = (request: { url: string }) => Response | Promise<Response>;

function getHandler(): Handler {
  expect(protocolMock.handle).toHaveBeenCalledTimes(1);
  expect(protocolMock.handle.mock.calls[0]![0]).toBe('shiguang-image');
  return protocolMock.handle.mock.calls[0]![1] as Handler;
}

describe('registerImageProtocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerImageProtocol();
  });

  it("注册 protocol.handle('shiguang-image', ...)", () => {
    expect(protocolMock.handle).toHaveBeenCalledTimes(1);
    expect(protocolMock.handle.mock.calls[0]![0]).toBe('shiguang-image');
  });

  it('images 根内存在的 .png 经 net.fetch(file://) 返回', async () => {
    const absPath = path.join(imagesDir, 'a.png');
    existsSyncMock.mockReturnValue(true);
    netMock.fetch.mockResolvedValue(new Response('png-bytes', { status: 200 }));

    const res = await getHandler()({ url: 'shiguang-image://images/a.png' });

    expect(appMock.getPath).toHaveBeenCalledWith('userData');
    expect(existsSyncMock).toHaveBeenCalledWith(absPath);
    expect(netMock.fetch).toHaveBeenCalledWith(pathToFileURL(absPath).toString());
    expect(res.status).toBe(200);
  });

  it('host 形态 URL（shiguang-image://a.png）按 basename 解析到 images 根', async () => {
    const absPath = path.join(imagesDir, 'b.png');
    existsSyncMock.mockReturnValue(true);
    netMock.fetch.mockResolvedValue(new Response('ok', { status: 200 }));

    await getHandler()({ url: 'shiguang-image://b.png' });

    expect(existsSyncMock).toHaveBeenCalledWith(absPath);
    expect(netMock.fetch).toHaveBeenCalledWith(pathToFileURL(absPath).toString());
  });

  it('非 .png 后缀返回 404 空 Response 且不读盘', async () => {
    const res = await getHandler()({ url: 'shiguang-image://images/a.txt' });

    expect(res.status).toBe(404);
    expect(netMock.fetch).not.toHaveBeenCalled();
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it('文件不存在返回 404 空 Response', async () => {
    existsSyncMock.mockReturnValue(false);

    const res = await getHandler()({ url: 'shiguang-image://images/missing.png' });

    expect(res.status).toBe(404);
    expect(netMock.fetch).not.toHaveBeenCalled();
  });

  it('路径穿越（../ 编码）被 basename 白名单收敛到 images 根内，不越界访问', async () => {
    existsSyncMock.mockReturnValue(false);

    const res = await getHandler()({
      url: 'shiguang-image://images/..%2F..%2Fetc%2Fsecret.png',
    });

    expect(res.status).toBe(404);
    // 无论是否存在，访问目标必须仍在 images 根内（isSubPath 语义）
    const accessed = existsSyncMock.mock.calls[0]![0] as string;
    expect(
      accessed === imagesDir || accessed.startsWith(imagesDir + path.sep),
    ).toBe(true);
    expect(accessed).not.toContain('etc');
  });
});

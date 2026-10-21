/**
 * shiguang-image:// 自定义协议：记录页 <img> 只读加载 userData/images/ 内 PNG。
 * 文件名白名单化（basename）+ isSubPath 防目录穿越 + 存在性校验；
 * 越界 / 非 .png / 不存在一律返回 404 空 Response（渲染端 onError 兜底「图片丢失」占位）。
 * 注册须在 app ready 后（装配见任务 13，窗口创建之前）。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, net, protocol } from 'electron';
import { isSubPath } from '../lib/pathGuard';

export function registerImageProtocol(): void {
  protocol.handle('shiguang-image', (request) => {
    const imagesDir = path.join(app.getPath('userData'), 'images');
    const url = new URL(request.url);
    // 取 pathname 的 basename；host 形态（shiguang-image://a.png）pathname 为 '/'，回退取 host
    const rawName =
      url.pathname && url.pathname !== '/' ? url.pathname : `/${url.host}`;
    const basename = path.basename(decodeURIComponent(rawName));
    const resolved = path.join(imagesDir, basename);

    if (
      isSubPath(imagesDir, resolved) &&
      path.extname(resolved) === '.png' &&
      existsSync(resolved)
    ) {
      return net.fetch(pathToFileURL(resolved).toString());
    }
    return new Response(null, { status: 404 });
  });
}

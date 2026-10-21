import path from 'node:path';

/**
 * 判断 target 是否位于 root 目录之内（含 root 本身）。
 * 两路径均经 path.resolve 规范化后按字符串前缀判定，不访问文件系统、不抛错。
 * 用于 imageProtocol 等场景防止 `../` 路径穿越与同级目录前缀混淆（如 /root/images-evil）。
 */
export function isSubPath(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(resolvedRoot + path.sep)
  );
}

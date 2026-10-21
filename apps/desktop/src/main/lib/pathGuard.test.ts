import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSubPath } from './pathGuard';

const imagesRoot = path.resolve('/root/images');

describe('isSubPath', () => {
  it('images 根目录内的文件返回 true', () => {
    expect(isSubPath(imagesRoot, path.join(imagesRoot, 'a.png'))).toBe(true);
    expect(
      isSubPath(imagesRoot, path.join(imagesRoot, 'sub', 'b.png')),
    ).toBe(true);
  });

  it('target 等于 root 本身返回 true', () => {
    expect(isSubPath(imagesRoot, imagesRoot)).toBe(true);
  });

  it('../ 路径穿越返回 false', () => {
    expect(
      isSubPath(imagesRoot, path.resolve(imagesRoot, '..', 'secret.png')),
    ).toBe(false);
    expect(
      isSubPath(imagesRoot, path.resolve(imagesRoot, '..', '..', 'x.png')),
    ).toBe(false);
  });

  it('同级前缀混淆（images-evil 对 images）返回 false', () => {
    const evilRoot = path.resolve('/root/images-evil');
    expect(isSubPath(imagesRoot, path.join(evilRoot, 'x.png'))).toBe(false);
  });

  it('不存在的路径按字符串判定，不抛错', () => {
    expect(() =>
      isSubPath(imagesRoot, path.join(imagesRoot, 'not-exist.png')),
    ).not.toThrow();
    expect(
      isSubPath(imagesRoot, path.join(imagesRoot, 'not-exist.png')),
    ).toBe(true);
    expect(
      isSubPath(imagesRoot, path.join(imagesRoot, '..', 'not-exist.png')),
    ).toBe(false);
  });

  it('相对路径输入经 path.resolve 规范化后判定', () => {
    expect(isSubPath(imagesRoot, path.join(imagesRoot, '.', 'a.png'))).toBe(
      true,
    );
  });
});

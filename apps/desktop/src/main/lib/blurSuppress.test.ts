import { describe, expect, it } from 'vitest';
import { nextSuppressUntil, shouldSuppressPetClick } from './blurSuppress';

describe('nextSuppressUntil', () => {
  it('默认延迟 300ms：返回 now + 300', () => {
    expect(nextSuppressUntil(1000)).toBe(1300);
  });

  it('显式传入 delayMs 时按该延迟计算', () => {
    expect(nextSuppressUntil(1000, 500)).toBe(1500);
  });

  it('delayMs 传 0 时返回 now 本身', () => {
    expect(nextSuppressUntil(1000, 0)).toBe(1000);
  });
});

describe('shouldSuppressPetClick', () => {
  it('now 在抑制窗口内（300ms 内）返回 true', () => {
    const until = nextSuppressUntil(1000);
    expect(shouldSuppressPetClick(until, 1299)).toBe(true);
  });

  it('now 到达边界（等于 suppressUntil）返回 false', () => {
    const until = nextSuppressUntil(1000);
    expect(shouldSuppressPetClick(until, 1300)).toBe(false);
  });

  it('now 越过抑制窗口返回 false', () => {
    const until = nextSuppressUntil(1000);
    expect(shouldSuppressPetClick(until, 2000)).toBe(false);
  });
});

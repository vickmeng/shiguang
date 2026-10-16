import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from './animations';

describe('ANIMATIONS 注册表', () => {
  it('idle 配置值正确：row 0、5 帧、8fps、循环播放', () => {
    expect(ANIMATIONS.idle).toEqual({ row: 0, frames: 5, fps: 8, loop: true });
  });

  it('注册表可新增条目，且不影响既有 idle 配置', () => {
    ANIMATIONS.walk = { row: 1, frames: 8, fps: 12, loop: true };

    expect(ANIMATIONS.walk).toEqual({ row: 1, frames: 8, fps: 12, loop: true });
    expect(ANIMATIONS.idle).toEqual({ row: 0, frames: 5, fps: 8, loop: true });
  });
});

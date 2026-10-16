import { describe, expect, it, vi } from 'vitest';
import type { AnimationDef } from './animations';
import { createStateMachine } from './stateMachine';

const DEFS: Record<string, AnimationDef> = {
  idle: { row: 0, frames: 6, fps: 8, loop: true },
  walk: { row: 1, frames: 8, fps: 12, loop: true },
  jump: { row: 2, frames: 4, fps: 10, loop: false },
  sleep: { row: 3, frames: 4, fps: 4, loop: true },
};

const PRIORITY: Record<string, number> = { idle: 0, walk: 1, jump: 2 };

function makeMachine() {
  return createStateMachine(DEFS, { fallback: 'idle', priority: PRIORITY });
}

describe('createStateMachine', () => {
  it('play 已注册状态切换成功并触发 onChange，回调收到状态名与 AnimationDef', () => {
    const sm = makeMachine();
    const listener = vi.fn();
    sm.onChange(listener);

    expect(sm.play('walk')).toBe(true);
    expect(sm.current).toBe('walk');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('walk', DEFS.walk);

    sm.play('jump');
    expect(sm.current).toBe('jump');
    expect(listener).toHaveBeenCalledWith('jump', DEFS.jump);
  });

  it('未注册状态返回 false 并拒绝切换、不触发 onChange', () => {
    const sm = makeMachine();
    const listener = vi.fn();
    sm.onChange(listener);

    expect(sm.play('run')).toBe(false);
    expect(sm.current).toBe('idle');
    expect(listener).not.toHaveBeenCalled();
  });

  it('高优先级可打断低优先级动画', () => {
    const sm = makeMachine();

    sm.play('idle');
    expect(sm.play('jump')).toBe(true);
    expect(sm.current).toBe('jump');
  });

  it('低优先级不可打断高优先级动画，返回 false 且状态不变', () => {
    const sm = makeMachine();
    sm.play('jump');

    expect(sm.play('idle')).toBe(false);
    expect(sm.current).toBe('jump');
  });

  it('force 可强制打断高优先级动画', () => {
    const sm = makeMachine();
    sm.play('jump');

    expect(sm.play('idle', { force: true })).toBe(true);
    expect(sm.current).toBe('idle');
  });

  it('notifyFinished 使 loop:false 的一次性动画回落 fallback 状态', () => {
    const sm = makeMachine();
    const listener = vi.fn();
    sm.onChange(listener);

    sm.play('jump');
    listener.mockClear();

    sm.notifyFinished();
    expect(sm.current).toBe('idle');
    expect(listener).toHaveBeenCalledWith('idle', DEFS.idle);
  });

  it('notifyFinished 在循环动画上无副作用（不会回落 fallback）', () => {
    const sm = makeMachine();
    sm.play('walk');

    sm.notifyFinished();
    expect(sm.current).toBe('walk');
  });

  it('onChange 返回取消订阅函数，取消后不再收到回调', () => {
    const sm = makeMachine();
    const listener = vi.fn();
    const unsubscribe = sm.onChange(listener);

    unsubscribe();
    sm.play('walk');
    expect(listener).not.toHaveBeenCalled();
  });

  it('无 priority 表时同优先级切换允许，回落仍生效', () => {
    const sm = createStateMachine(DEFS, { fallback: 'idle' });

    expect(sm.play('walk')).toBe(true);
    expect(sm.play('sleep')).toBe(true);
    sm.notifyFinished();
    expect(sm.current).toBe('sleep');
  });
});

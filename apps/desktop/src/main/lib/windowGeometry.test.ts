import { describe, expect, it } from 'vitest';
import {
  computeInputPosition,
  computePetPosition,
  type Rect,
} from './windowGeometry';

const workArea: Rect = { x: 0, y: 0, width: 1440, height: 900 };
const petBounds: Rect = { x: 1440 - 128, y: 900 - 104, width: 128, height: 104 };

describe('computePetPosition', () => {
  it('返回主屏工作区右下角坐标：128×104 宠物窗口留 margin 不贴边', () => {
    expect(computePetPosition(workArea, 16)).toEqual({
      x: 0 + 1440 - 128 - 16,
      y: 0 + 900 - 104 - 16,
    });
  });

  it('支持非零原点的工作区（多显示器偏移）', () => {
    const offsetArea: Rect = { x: -1920, y: 100, width: 1920, height: 1080 };
    expect(computePetPosition(offsetArea, 8)).toEqual({
      x: -1920 + 1920 - 128 - 8,
      y: 100 + 1080 - 104 - 8,
    });
  });
});

describe('computeInputPosition', () => {
  it('默认在宠物左侧弹出（flipped: false），间隔 gap，顶部与宠物对齐', () => {
    const midPet: Rect = { x: 800, y: 300, width: 128, height: 104 };

    const pos = computeInputPosition(
      midPet,
      { width: 360, height: 200 },
      workArea,
      8,
    );

    expect(pos.flipped).toBe(false);
    expect(pos.x).toBe(midPet.x - 360 - 8);
    expect(pos.y).toBe(midPet.y);
  });

  it('宠物左侧空间不足时翻到右侧（flipped: true）', () => {
    const leftEdgePet: Rect = { x: 0, y: 400, width: 128, height: 104 };

    const pos = computeInputPosition(
      leftEdgePet,
      { width: 360, height: 200 },
      workArea,
      8,
    );

    expect(pos.flipped).toBe(true);
    expect(pos.x).toBe(leftEdgePet.x + 128 + 8);
  });

  it('竖直方向越界时向下夹紧，保证输入框完整落在工作区内', () => {
    // 宠物贴着工作区底部，输入框比宠物高，顶部对齐会溢出底部
    const pos = computeInputPosition(
      petBounds,
      { width: 360, height: 300 },
      workArea,
      8,
    );

    expect(pos.y + 300).toBeLessThanOrEqual(workArea.y + workArea.height);
    expect(pos.y).toBeGreaterThanOrEqual(workArea.y);
  });

  it('翻转到右侧后仍越界时，水平方向夹紧回工作区内', () => {
    // 宠物靠工作区左缘：左侧放不下触发翻转，右侧空间也不足触发夹紧
    const leftPet: Rect = { x: 0, y: 300, width: 128, height: 104 };
    const narrowArea: Rect = { x: 0, y: 0, width: 400, height: 900 };

    const pos = computeInputPosition(
      leftPet,
      { width: 360, height: 200 },
      narrowArea,
      8,
    );

    expect(pos.flipped).toBe(true);
    expect(pos.x).toBe(narrowArea.x + narrowArea.width - 360);
  });
});

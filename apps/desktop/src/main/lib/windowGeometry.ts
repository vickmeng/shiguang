export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 宠物窗口显示尺寸（精灵图 0.5 缩放后 128×104） */
const PET_WIDTH = 128;
const PET_HEIGHT = 104;

/**
 * 计算宠物窗口位于主屏工作区右下角的坐标，留 margin 不贴 Dock。
 */
export function computePetPosition(
  workArea: Rect,
  margin: number,
): { x: number; y: number } {
  return {
    x: workArea.x + workArea.width - PET_WIDTH - margin,
    y: workArea.y + workArea.height - PET_HEIGHT - margin,
  };
}

/**
 * 计算输入框定位：默认弹出在宠物左侧，左侧空间不足时翻到右侧，
 * 最终结果夹紧到 workArea 内保证完整可见。
 */
export function computeInputPosition(
  petBounds: Rect,
  inputSize: { width: number; height: number },
  workArea: Rect,
  gap: number,
): { x: number; y: number; flipped: boolean } {
  const leftX = petBounds.x - inputSize.width - gap;
  const fitsLeft = leftX >= workArea.x;
  const flipped = !fitsLeft;

  const rawX = flipped ? petBounds.x + petBounds.width + gap : leftX;
  const rawY = petBounds.y;

  const maxX = workArea.x + workArea.width - inputSize.width;
  const maxY = workArea.y + workArea.height - inputSize.height;

  return {
    x: Math.min(Math.max(rawX, workArea.x), maxX),
    y: Math.min(Math.max(rawY, workArea.y), maxY),
    flipped,
  };
}

export interface AnimationDef {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}

export const ANIMATIONS: Record<string, AnimationDef> = {
  // idle 行（第 0 行）实测仅前 5 格有内容（帧间距 192px）
  idle: { row: 0, frames: 5, fps: 8, loop: true },
};

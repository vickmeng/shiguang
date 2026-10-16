// pet 渲染层：精灵图帧切分与 AnimatedSprite 创建（只懂渲染，不 import 状态机逻辑）
//
// 精灵图整图 1536×1872，8 列 × 9 行均匀网格，单帧 192×208（8×192=1536，9×208=1872）。
// 注意：行内帧数不固定（如 idle 行仅前 5 格有内容），由 ANIMATIONS 的 frames 字段决定。
// vite import 进 bundle。PixiJS v8：切片通过共享 TextureSource + frame Rectangle 创建，
// 不做像素拷贝。
import { AnimatedSprite, Rectangle, Texture } from 'pixi.js';
import type { AnimationDef } from './animations';

export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;
export const COLS = 8;
export const ROWS = 9;
/** 渲染缩放：192×208 帧 × 0.5 = 96×104，高度贴合宠物窗口内容尺寸（128×104） */
export const SCALE = 0.5;
/** 宠物窗口内容宽度（petWindow PET_WIDTH）：sprite 显示宽 96，居中留左右各 16px */
export const SPRITE_X_OFFSET = (128 - FRAME_WIDTH * SCALE) / 2;

// 切片缓存：同一整图 Texture + 同一网格参数只切一次，重复创建精灵时复用切片
const sliceCache = new WeakMap<Texture, Map<string, Texture[]>>();

/**
 * 按网格把整图切成全部帧，返回扁平数组（行优先：index = row * cols + col）。
 * 结果按 (baseTexture, 网格参数) 缓存，重复调用直接复用。
 */
export function sliceFrames(
  baseTexture: Texture,
  frameW = FRAME_WIDTH,
  frameH = FRAME_HEIGHT,
  cols = COLS,
  rows = ROWS,
): Texture[] {
  let byGrid = sliceCache.get(baseTexture);
  if (!byGrid) {
    byGrid = new Map();
    sliceCache.set(baseTexture, byGrid);
  }
  const key = `${cols}x${rows}@${frameW}x${frameH}`;
  const cached = byGrid.get(key);
  if (cached) return cached;

  const frames: Texture[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      frames.push(
        new Texture({
          source: baseTexture.source,
          frame: new Rectangle(col * frameW, row * frameH, frameW, frameH),
        }),
      );
    }
  }
  byGrid.set(key, frames);
  return frames;
}

/**
 * 按 def.row 取对应行切片创建 AnimatedSprite：
 * animationSpeed = fps / 60（Pixi 以 60fps 基准推进帧序列），loop 透传，整体缩放 SCALE。
 */
export function createAnimatedSprite(def: AnimationDef, frames: Texture[]): AnimatedSprite {
  const start = def.row * COLS;
  const rowFrames = frames.slice(start, start + def.frames);
  const sprite = new AnimatedSprite(rowFrames);
  sprite.animationSpeed = def.fps / 60;
  sprite.loop = def.loop;
  sprite.scale.set(SCALE);
  sprite.x = SPRITE_X_OFFSET;
  return sprite;
}

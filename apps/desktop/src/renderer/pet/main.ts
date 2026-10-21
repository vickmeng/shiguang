/**
 * 宠物渲染入口：Pixi v8 画布 + 状态机接线 + 单击判定。
 *
 * 装配链路：
 *   vite import 精灵图 → Application（透明背景 128×104）→ sliceFrames 切帧
 *   → createStateMachine(ANIMATIONS, { fallback: 'idle' }) → 初始 play('idle')
 *   → onChange 驱动 createAnimatedSprite 切换 → window.api.pet.onSetState 接预留口子。
 *
 * 唤出输入框：监听容器 contextmenu（右键）调 window.api.pet.clicked()，
 * 与左键单击同一协调转发（显隐 toggle 逻辑在 inputWindow 内，见 petWindow）。
 * 左键整窗为 -webkit-app-region: drag 拖动区（OS 级拖动），拖动区会吞掉左键
 * 全部 DOM 事件，故唤出入口放在右键上；preventDefault 禁掉默认右键菜单行为。
 */
/// <reference types="vite/client" />
// 副作用导入：安装免 eval 的 shader/ubo polyfill（Pixi v8 默认用 new Function
// 生成着色器同步代码，会被 pet.html 的 CSP（无 unsafe-eval）拦截导致白屏）
import 'pixi.js/unsafe-eval';
import { Application, Assets, type AnimatedSprite, type Texture } from 'pixi.js';
import spritesUrl from '../assets/pet/pet-sprites.webp';
import { ANIMATIONS } from './core/animations';
import { createStateMachine } from './core/stateMachine';
import { createAnimatedSprite, sliceFrames } from './core/sprite';

const PET_WIDTH = 128;
const PET_HEIGHT = 104;

/** 提示自动消失时长（ms），与 console toast 的 TOAST_DURATION 约定一致 */
const TOAST_DURATION = 2000;

// 基础设施保留：后续里程碑 toast 复用
// 与 console toast 同语义的最小实现：宠物窗无 React/Tailwind，用 vanilla DOM
// 内联样式实现同款轻提示（底部居中、约 2s 自动消失；失败态红色，同 destructive）
let toastHost: HTMLDivElement | null = null;
function toast(message: string, variant: 'default' | 'destructive' = 'default'): void {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.setAttribute('role', 'status');
    Object.assign(toastHost.style, {
      position: 'fixed',
      bottom: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'none',
      zIndex: '50'
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(toastHost);
  }
  const item = document.createElement('div');
  Object.assign(item.style, {
      maxWidth: '260px',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '14px',
      lineHeight: '1.5',
      textAlign: 'center',
      wordBreak: 'break-word',
      color: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      backgroundColor: variant === 'destructive' ? '#dc2626' : '#262626'
  } satisfies Partial<CSSStyleDeclaration>);
  item.textContent = message;
  toastHost.appendChild(item);
  setTimeout(() => item.remove(), TOAST_DURATION);
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('pet 容器 #app 不存在');

  const app = new Application();
  await app.init({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    backgroundAlpha: 0, // 透明背景，配合 frameless transparent 窗口
    antialias: true,
  });
  container.appendChild(app.canvas);

  const baseTexture = await Assets.load<Texture>(spritesUrl);
  const frames = sliceFrames(baseTexture);

  const sm = createStateMachine(ANIMATIONS, { fallback: 'idle' });

  let currentSprite: AnimatedSprite | null = null;
  sm.onChange((_state, def) => {
    if (currentSprite) {
      app.stage.removeChild(currentSprite);
      currentSprite.destroy();
      currentSprite = null;
    }
    const sprite = createAnimatedSprite(def, frames);
    if (!def.loop) {
      // 一次性动画播完由渲染层通知状态机回落 fallback
      sprite.onComplete = () => sm.notifyFinished();
    }
    app.stage.addChild(sprite);
    sprite.play();
    currentSprite = sprite;
  });

  // 初始进入 idle（触发首次 onChange，创建并播放精灵）
  sm.play('idle');

  // M1 预留口子：主进程下发宠物状态（如后续里程碑的 walking/capture 动效）
  window.api.pet.onSetState((state) => {
    sm.play(state);
  });

  // 右键唤出输入框：contextmenu 不受拖动区拦截，preventDefault 禁默认右键菜单
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.pet.clicked();
  });
}

void bootstrap();

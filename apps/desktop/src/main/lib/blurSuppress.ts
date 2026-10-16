/**
 * 宠物点击抑制窗口的纯逻辑（AC-3）。
 *
 * 输入框因 blur / 关闭而收起后，短时间内用户「点击输入框内某处」的 mousedown
 * 会冒泡到宠物窗口触发 click，造成输入框刚收起又被立即唤起。主进程在收起时
 * 记录 suppressUntil = nextSuppressUntil(Date.now())，此后 pet:clicked 到达时
 * 用 shouldSuppressPetClick 判定是否在抑制窗口内，是则忽略。
 */

/** 默认抑制时长：300ms。 */
const DEFAULT_SUPPRESS_MS = 300;

/** 返回以 now 为起点、延迟 delayMs 后的抑制截止时间戳。 */
export function nextSuppressUntil(now: number, delayMs: number = DEFAULT_SUPPRESS_MS): number {
  return now + delayMs;
}

/** now 早于 suppressUntil（含边界，等于即解除抑制）时返回 true。 */
export function shouldSuppressPetClick(suppressUntil: number, now: number): boolean {
  return now < suppressUntil;
}

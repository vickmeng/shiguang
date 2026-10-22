/**
 * 标签 chip 文字色（YIQ 亮度判断）：chip 实心底色 = tag.color，
 * 文字色按底色亮度自动切换——亮底用深字 #1f2937，暗底用白字 #ffffff；
 * 非法输入（非 #rgb/#rrggbb）回退深字 #1f2937。
 */
export function tagTextColor(bgColor: string): string {
  const hex = bgColor.replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return '#1f2937';
  }
  // YIQ 感知亮度（ITU-R BT.601 权重），阈值 128
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#1f2937' : '#ffffff';
}

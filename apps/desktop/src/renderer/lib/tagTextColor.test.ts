// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tagTextColor } from './tagTextColor';

describe('tagTextColor YIQ 亮度取文字色', () => {
  it('亮底返回深字 #1f2937，暗底返回白字 #ffffff', () => {
    expect(tagTextColor('#f59e0b')).toBe('#1f2937');
    expect(tagTextColor('#ffffff')).toBe('#1f2937');
    expect(tagTextColor('#d4d4d4')).toBe('#1f2937');
    expect(tagTextColor('#000000')).toBe('#ffffff');
    expect(tagTextColor('#0f766e')).toBe('#ffffff');
    expect(tagTextColor('#1e3a8a')).toBe('#ffffff');
  });

  it('支持 #rgb 短格式', () => {
    expect(tagTextColor('#fff')).toBe('#1f2937');
    expect(tagTextColor('#000')).toBe('#ffffff');
  });

  it('非法输入回退 #1f2937', () => {
    expect(tagTextColor('')).toBe('#1f2937');
    expect(tagTextColor('red')).toBe('#1f2937');
    expect(tagTextColor('#12345')).toBe('#1f2937');
    expect(tagTextColor('#gggggg')).toBe('#1f2937');
  });
});

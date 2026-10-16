// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiguangApi } from '../../../../preload';
import { CaptureForm } from './capture-form';

function createApiMock() {
  const api: ShiguangApi = {
    capture: {
      create: vi.fn().mockResolvedValue({
        id: 1,
        text: '',
        sourceApp: null,
        createdAt: new Date().toISOString(),
      }),
    },
    input: {
      blur: vi.fn(),
      close: vi.fn(),
    },
    pet: {
      clicked: vi.fn(),
      onSetState: vi.fn(() => () => {}),
    },
  };
  return api;
}

describe('CaptureForm', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('实时渲染字数统计（口径 当前字数/5000）', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '拾光');

    expect(screen.getByText('2/5000')).toBeTruthy();
  });

  it('textarea 带原生 maxlength=5000 属性', () => {
    window.api = createApiMock();
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.getAttribute('maxlength')).toBe('5000');
  });

  it('零长度禁用提交，全空格视为有内容可提交', async () => {
    const user = userEvent.setup();
    window.api = createApiMock();
    render(<CaptureForm />);

    const submit = screen.getByRole('button', { name: /拾光/ });
    expect(submit).toHaveProperty('disabled', true);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '  ');
    expect(submit).toHaveProperty('disabled', false);

    await user.clear(textarea);
    expect(submit).toHaveProperty('disabled', true);
  });

  it('提交调用 capture.create，loading 期间按钮与输入框禁用防连点，成功后显示「✓ 已拾光」', async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: unknown) => void;
    const api = createApiMock();
    api.capture.create = vi.fn(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        }),
    ) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');
    const submit = screen.getByRole('button', { name: /拾光/ });
    await user.click(submit);

    expect(api.capture.create).toHaveBeenCalledWith({ text: 'hello' });

    // loading 态：按钮与 textarea 均禁用，防连点
    expect(submit).toHaveProperty('disabled', true);
    expect(textarea).toHaveProperty('disabled', true);
    await user.click(submit);
    expect(api.capture.create).toHaveBeenCalledTimes(1);

    resolveCreate({
      id: 1,
      text: 'hello',
      sourceApp: null,
      createdAt: new Date().toISOString(),
    });

    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();
  });

  it('成功后不收起窗口：闪现后清空内容回到可录态', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    await user.click(screen.getByRole('button', { name: /拾光/ }));

    // 成功态反馈在按钮上，窗口不收起
    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();
    expect(api.input.close).not.toHaveBeenCalled();

    await vi.waitFor(
      () => {
        expect(textarea).toHaveProperty('value', '');
      },
      { timeout: 3000, interval: 50 },
    );

    // 回到可录态：按钮恢复「拾光」，空内容时禁用，窗口全程未收起
    const submit = screen.getByRole('button', { name: '拾光' });
    expect(submit).toHaveProperty('disabled', true);
    expect(api.input.close).not.toHaveBeenCalled();
  });

  it('提交失败：按钮显示失败态，闪现后回到可录态且内容保留供重试', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    api.capture.create = vi
      .fn()
      .mockRejectedValue(new Error('db busy')) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'keep me');
    await user.click(screen.getByRole('button', { name: /拾光/ }));

    expect(await screen.findByText('提交失败')).toBeTruthy();

    await vi.waitFor(
      () => {
        expect(screen.getByRole('button', { name: '拾光' })).toHaveProperty(
          'disabled',
          false,
        );
      },
      { timeout: 3000, interval: 50 },
    );

    // 失败回到可录态后内容保留，可直接重试；窗口不收起
    expect(textarea).toHaveProperty('value', 'keep me');
    expect(api.input.close).not.toHaveBeenCalled();
  });

  it('粘贴图片/文件时提示「暂不支持」且内容不写入输入框', () => {
    window.api = createApiMock();
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    const imageFile = new File(['x'], 'cat.png', { type: 'image/png' });
    fireEvent.paste(textarea, {
      clipboardData: {
        files: [imageFile],
        types: ['Files'],
        getData: () => '',
      },
    });

    expect(screen.getByText('暂不支持')).toBeTruthy();
    expect(textarea).toHaveProperty('value', '');
    expect(window.api.capture.create).not.toHaveBeenCalled();
  });

  it('容器级 Esc 调用 input.close()；textarea blur 不触发收起信号（由主进程窗口级 blur 承担）', () => {
    window.api = createApiMock();
    render(<CaptureForm />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(window.api.input.close).toHaveBeenCalledTimes(1);

    // textarea 失焦不得同步收起窗口：否则点击「拾光」按钮的 mousedown
    // 先触发 blur 收起，click 落不到按钮，鼠标提交路径被掐断
    fireEvent.blur(textarea);
    expect(window.api.input.blur).not.toHaveBeenCalled();
  });
});

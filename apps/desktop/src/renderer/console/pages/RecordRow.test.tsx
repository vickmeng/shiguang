// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CaptureRecord } from '@shiguang/shared';
import type { ShiguangApi } from '../../../preload';
import { Toaster } from '../../components/ui/toast';
import { RecordRow } from './RecordRow';

function makeTextRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 1,
    text: '一条文字记录',
    sourceApp: null,
    createdAt: '2024-05-01T08:30:00.000Z',
    imagePaths: [],
    ...overrides,
  };
}

function makeImageRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 2,
    text: '',
    sourceApp: 'screenshot',
    createdAt: '2024-05-01T08:30:00.000Z',
    imagePaths: ['images/abc-uuid.png'],
    ...overrides,
  };
}

function createApiMock(): ShiguangApi {
  return {
    capture: {
      copyImage: vi.fn(() => Promise.resolve()),
    },
  } as unknown as ShiguangApi;
}

function renderRow(props: Partial<Parameters<typeof RecordRow>[0]> = {}) {
  const onToggleExpand = vi.fn();
  const onToggleSelect = vi.fn();
  const onDelete = vi.fn();
  render(
    <>
      <RecordRow
        record={makeTextRecord()}
        expanded={false}
        selected={false}
        onToggleExpand={onToggleExpand}
        onToggleSelect={onToggleSelect}
        onDelete={onDelete}
        {...props}
      />
      <Toaster />
    </>
  );
  return { onToggleExpand, onToggleSelect, onDelete };
}

describe('RecordRow 记录行', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('纯文字行（imagePaths: []）渲染文字预览（截断类 line-clamp-3），展开时移除截断', () => {
    renderRow();
    const preview = screen.getByText('一条文字记录');
    expect(preview.className).toContain('line-clamp-3');

    cleanup();
    renderRow({ expanded: true });
    expect(screen.getByText('一条文字记录').className).not.toContain('line-clamp-3');
  });

  it('含图行渲染 shiguang-image:// 缩略图（相对路径 basename）替代文字预览', () => {
    renderRow({ record: makeImageRecord() });
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('shiguang-image://abc-uuid.png');
    // 无文字预览（line-clamp 段落不存在）
    expect(document.querySelector('.line-clamp-3')).toBeNull();
  });

  it('多图行（imagePaths.length > 1）缩略块右上角渲染「共N张」角标', () => {
    renderRow({
      record: makeImageRecord({
        imagePaths: ['images/a.png', 'images/b.png', 'images/c.png'],
      }),
    });
    const badge = screen.getByText('共3张');
    expect(badge).toBeTruthy();
    // 角标绝对定位于缩略块右上角（父容器相对定位）
    expect(badge.className).toContain('absolute');
    expect(badge.parentElement!.className).toContain('relative');
  });

  it('单图行（imagePaths.length === 1）不渲染「共N张」角标', () => {
    renderRow({ record: makeImageRecord() });
    expect(screen.queryByText(/共\d+张/)).toBeNull();
  });

  it('含图行点复制调 capture.copyImage({ id }) 并弹 toast，不走 clipboard.writeText', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderRow({ record: makeImageRecord() });

    await user.click(screen.getByRole('button', { name: '复制记录 2' }));

    expect(api.capture.copyImage).toHaveBeenCalledWith({ id: 2 });
    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText('已复制到剪贴板')).toBeTruthy();
  });

  it('纯文字行点复制仍走 clipboard.writeText 并弹 toast，不调 copyImage', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderRow({ record: makeTextRecord() });

    await user.click(screen.getByRole('button', { name: '复制记录 1' }));

    expect(writeText).toHaveBeenCalledWith('一条文字记录');
    expect(api.capture.copyImage).not.toHaveBeenCalled();
    expect(await screen.findByText('已复制到剪贴板')).toBeTruthy();
  });

  it('含图行展开时渲染纵向全列大图（max-w-[480px] w-full object-contain），折叠时仅缩略图', () => {
    renderRow({ record: makeImageRecord(), expanded: true });
    const imgs = screen.getAllByRole('img') as HTMLImageElement[];
    expect(imgs).toHaveLength(1);
    const large = imgs[0];
    expect(large.className).toContain('max-w-[480px]');
    expect(large.className).toContain('w-full');
    expect(large.className).toContain('object-contain');
    expect(large.src).toBe('shiguang-image://abc-uuid.png');

    cleanup();
    renderRow({ record: makeImageRecord(), expanded: false });
    const collapsed = screen.getAllByRole('img') as HTMLImageElement[];
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].className).toContain('w-24');
  });

  it('多图行展开时纵向大图仍取首图 imagePaths[0]', () => {
    renderRow({
      record: makeImageRecord({ imagePaths: ['images/a.png', 'images/b.png'] }),
      expanded: true,
    });
    const imgs = screen.getAllByRole('img') as HTMLImageElement[];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src).toBe('shiguang-image://a.png');
    expect(imgs[0].className).toContain('w-full');
  });

  it('含图行 img 触发 error 后渲染「图片丢失」占位，替代缩略图/大图', () => {
    renderRow({ record: makeImageRecord(), expanded: true });
    for (const img of screen.getAllByRole('img')) {
      fireEvent.error(img);
    }
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('图片丢失')).toBeTruthy();
    // 灰色虚线框占位
    expect(document.querySelector('.border-dashed')).toBeTruthy();
  });

  it('「图片丢失」占位态下复制/删除按钮仍可用', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    const handlers = renderRow({ record: makeImageRecord() });
    fireEvent.error(screen.getByRole('img'));

    await user.click(screen.getByRole('button', { name: '复制记录 2' }));
    expect(api.capture.copyImage).toHaveBeenCalledWith({ id: 2 });

    await user.click(screen.getByRole('button', { name: '删除记录 2' }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it('点击行触发 onToggleExpand，点击复选框/复制/删除均阻止冒泡', async () => {
    const user = userEvent.setup();
    const handlers = renderRow();

    await user.click(screen.getByText('一条文字记录'));
    expect(handlers.onToggleExpand).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleExpand).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '复制记录 1' }));
    expect(handlers.onToggleExpand).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '删除记录 1' }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleExpand).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CaptureRecord } from '@shiguang/shared';
import type { ShiguangApi } from '../../../preload';
import { Toaster } from '../../components/ui/toast';
import { RecordRow } from './RecordRow';

function makeTextRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 1,
    text: '一条文字记录',
    document: null,
    sourceApp: null,
    createdAt: '2024-05-01T08:30:00.000Z',
    imagePaths: [],
    tags: [],
    ...overrides,
  };
}

/** 图文记录：document 为唯一事实来源（说明段 + 独占图片段落） */
function makeImageRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 2,
    text: '图文记录说明',
    document: JSON.stringify({
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: '图文记录说明' }] },
          { type: 'paragraph', children: [{ type: 'image', src: 'images/abc-uuid.png' }] },
        ],
      },
    }),
    sourceApp: 'screenshot',
    createdAt: '2024-05-01T08:30:00.000Z',
    imagePaths: ['images/abc-uuid.png'],
    tags: [],
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
  const { container } = render(
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
  return { container, onToggleExpand, onToggleSelect, onDelete };
}

describe('RecordRow 记录行', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('纯文字行渲染文字预览：收起态限高 max-h-40，展开态移除限高', () => {
    const { container } = render(
      <>
        <RecordRow
          record={makeTextRecord()}
          expanded={false}
          selected={false}
          onToggleExpand={vi.fn()}
          onToggleSelect={vi.fn()}
          onDelete={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText('一条文字记录')).toBeTruthy();
    expect(container.querySelector('.max-h-40')).toBeTruthy();
    expect(container.querySelector('.bg-gradient-to-t')).toBeTruthy();

    cleanup();
    const { container: expandedContainer } = render(
      <>
        <RecordRow
          record={makeTextRecord()}
          expanded
          selected={false}
          onToggleExpand={vi.fn()}
          onToggleSelect={vi.fn()}
          onDelete={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText('一条文字记录')).toBeTruthy();
    expect(expandedContainer.querySelector('.max-h-40')).toBeNull();
    expect(expandedContainer.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('图文行经 RichCapturePreview 渲染段落 + shiguang-image:// 图片（相对路径 basename），收起/展开形态一致', () => {
    const { container } = renderRow({ record: makeImageRecord() });
    expect(screen.getByText('图文记录说明')).toBeTruthy();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('shiguang-image://abc-uuid.png');

    cleanup();
    renderRow({ record: makeImageRecord(), expanded: true });
    expect(screen.getByText('图文记录说明')).toBeTruthy();
    expect(document.querySelector('img')!.getAttribute('src')).toBe(
      'shiguang-image://abc-uuid.png',
    );
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

  it('record.tags 渲染实心 chips：底色取 tagColors 命中值，文字色随底色亮度切换', () => {
    renderRow({
      record: makeTextRecord({ tags: ['工作', '阅读'] }),
      tagColors: { 工作: '#f59e0b', 阅读: '#0f766e' },
    });
    const chip = screen.getByText('工作');
    expect(chip.className).toContain('rounded-full');
    // jsdom 将 hex 归一化为 rgb；亮底（琥珀）→ 深字
    expect(chip.style.backgroundColor).toBe('rgb(245, 158, 11)');
    expect(chip.style.color).toBe('rgb(31, 41, 55)');
    const chip2 = screen.getByText('阅读');
    expect(chip2.style.backgroundColor).toBe('rgb(15, 118, 110)');
    // 暗底 → 白字
    expect(chip2.style.color).toBe('rgb(255, 255, 255)');
  });

  it('tagColors 缺失该项名（已删标签）→ 实心 #d4d4d4 + 白字', () => {
    renderRow({
      record: makeTextRecord({ tags: ['已删标签'] }),
      tagColors: { 工作: '#f59e0b' },
    });
    const chip = screen.getByText('已删标签');
    expect(chip.style.backgroundColor).toBe('rgb(212, 212, 212)');
    expect(chip.style.color).toBe('rgb(255, 255, 255)');
  });

  it('tags: [] 不渲染 chips 行', () => {
    renderRow({ record: makeTextRecord({ tags: [] }) });
    expect(document.querySelector('.flex-wrap')).toBeNull();
  });

  it('未传 tagColors prop 不抛错（全部灰底白字）', () => {
    renderRow({ record: makeTextRecord({ tags: ['工作'] }) });
    const chip = screen.getByText('工作');
    expect(chip.style.backgroundColor).toBe('rgb(212, 212, 212)');
    expect(chip.style.color).toBe('rgb(255, 255, 255)');
  });
});

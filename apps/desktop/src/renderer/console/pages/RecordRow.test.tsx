// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CaptureRecord, Grade } from '@shiguang/shared';
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
    aiSummary: null,
    aiGrade: null,
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
    aiSummary: null,
    aiGrade: null,
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
  const onToggleSelect = vi.fn();
  const onOpenDetail = vi.fn();
  const onDelete = vi.fn();
  const { container } = render(
    <>
      <table>
        <tbody>
          <RecordRow
            record={makeTextRecord()}
            selected={false}
            onToggleSelect={onToggleSelect}
            onOpenDetail={onOpenDetail}
            onDelete={onDelete}
            {...props}
          />
        </tbody>
      </table>
      <Toaster />
    </>
  );
  return { container, onToggleSelect, onOpenDetail, onDelete };
}

describe('RecordRow 记录表格行', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染根为 tr 且恰含六个 td，列序为 复选框/时间/摘要/级别/标签/操作', () => {
    const { container } = renderRow({
      record: makeTextRecord({
        aiSummary: '这是一句摘要',
        aiGrade: 'high',
        tags: ['工作'],
      }),
      tagColors: { 工作: '#f59e0b' },
    });

    expect(container.querySelector('tr')).toBeTruthy();
    const tds = container.querySelectorAll('td');
    expect(tds.length).toBe(6);

    // textContent 列序断言：复选框(空) → 时间 → 摘要 → 级别 → 标签 → 操作
    const texts = Array.from(tds).map((td) => td.textContent ?? '');
    expect(texts[0]).toBe('');
    expect(texts[1]).toContain('2024');
    expect(texts[2]).toContain('这是一句摘要');
    expect(texts[3]).toContain('高');
    expect(texts[4]).toContain('工作');
    expect(texts[5]).toContain('复制');
    expect(texts[5]).toContain('删除');
  });

  it('行内不渲染内容预览（无 RichCapturePreview 图文全文）', () => {
    const { container } = renderRow({ record: makeImageRecord() });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('图文记录说明');
  });

  it('aiSummary 非空时摘要 button 点击触发 onOpenDetail', async () => {
    const user = userEvent.setup();
    const handlers = renderRow({
      record: makeTextRecord({ aiSummary: '这是一句摘要' }),
    });
    await user.click(screen.getByRole('button', { name: '这是一句摘要' }));
    expect(handlers.onOpenDetail).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleSelect).not.toHaveBeenCalled();
  });

  it('aiSummary 为 null/undefined 时渲染「—」占位且无 button', () => {
    const { container: nullContainer } = renderRow({
      record: makeTextRecord({ aiSummary: null }),
    });
    expect(nullContainer.textContent).toContain('—');
    expect(nullContainer.querySelector('td:nth-child(3) button')).toBeNull();
    cleanup();

    const { aiSummary: _omit, ...withoutSummary } = makeImageRecord();
    void _omit;
    const { container: undefContainer } = renderRow({ record: withoutSummary });
    expect(undefContainer.textContent).toContain('—');
    expect(undefContainer.querySelector('td:nth-child(3) button')).toBeNull();
  });

  it('aiGrade 各分支渲染徽标类名与文案：high→bg-red-50「高」', () => {
    const { container } = renderRow({
      record: makeTextRecord({ aiGrade: 'high' as Grade }),
    });
    const badge = container.querySelector('td:nth-child(4) span') as HTMLElement;
    expect(badge.textContent).toBe('高');
    expect(badge.className).toContain('bg-red-50');
    expect(badge.className).toContain('text-red-600');
  });

  it('aiGrade 为 mid 渲染 bg-neutral-100「中」', () => {
    const { container } = renderRow({
      record: makeTextRecord({ aiGrade: 'mid' as Grade }),
    });
    const badge = container.querySelector('td:nth-child(4) span') as HTMLElement;
    expect(badge.textContent).toBe('中');
    expect(badge.className).toContain('bg-neutral-100');
    expect(badge.className).toContain('text-neutral-600');
  });

  it('aiGrade 为 low 渲染 border-neutral-200「低」', () => {
    const { container } = renderRow({
      record: makeTextRecord({ aiGrade: 'low' as Grade }),
    });
    const badge = container.querySelector('td:nth-child(4) span') as HTMLElement;
    expect(badge.textContent).toBe('低');
    expect(badge.className).toContain('bg-transparent');
    expect(badge.className).toContain('border');
    expect(badge.className).toContain('border-neutral-200');
    expect(badge.className).toContain('text-neutral-400');
  });

  it('aiGrade 为 null/undefined 时级别 td 留空', () => {
    const { container: nullContainer } = renderRow({
      record: makeTextRecord({ aiGrade: null }),
    });
    expect(nullContainer.querySelector('td:nth-child(4) span')).toBeNull();
    cleanup();

    const { aiGrade: _omit, ...withoutGrade } = makeImageRecord();
    void _omit;
    const { container: undefContainer } = renderRow({ record: withoutGrade });
    expect(undefContainer.querySelector('td:nth-child(4) span')).toBeNull();
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

  it('复选框 onChange 触发 onToggleSelect，删除按钮触发 onDelete', async () => {
    const user = userEvent.setup();
    const handlers = renderRow();

    await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '删除记录 1' }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
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

  it('tags: [] 不渲染 chips', () => {
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

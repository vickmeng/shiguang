// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CaptureRecord } from '@shiguang/shared';
import { RecordDetailDialog } from './record-detail-dialog';

function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 1,
    text: '一条文字记录',
    document: null,
    sourceApp: null,
    createdAt: '2024-05-01T08:30:00.000Z',
    imagePaths: [],
    tags: [],
    aiSummary: '这是一句摘要',
    aiGrade: null,
    ...overrides,
  };
}

function renderDialog(props: Partial<Parameters<typeof RecordDetailDialog>[0]> = {}) {
  const onClose = vi.fn();
  const { container } = render(
    <RecordDetailDialog
      open
      record={makeRecord()}
      onClose={onClose}
      {...props}
    />,
  );
  return { container, onClose };
}

describe('RecordDetailDialog 记录详情弹窗', () => {
  afterEach(cleanup);

  it('open=false 或 record=null 时渲染 null（container 为空）', () => {
    const { container: closedContainer } = renderDialog({ open: false });
    expect(closedContainer.firstChild).toBeNull();

    cleanup();
    const { container: nullRecordContainer } = renderDialog({ record: null });
    expect(nullRecordContainer.firstChild).toBeNull();
  });

  it('open 时渲染 role=dialog 且 aria-modal=true（遮罩模式）', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // 遮罩存在（半透明覆盖层）
    expect(document.querySelector('.bg-black\\/40')).toBeTruthy();
  });

  it('点遮罩与点 aria-label=「关闭」按钮均触发 onClose（drag handle 不吞掉关闭 click）', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(document.querySelector('.bg-black\\/40') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('头部与全文区为兄弟结构：头部固定（record-detail-header + border-b），全文区是唯一 overflow-y-auto 滚动容器', () => {
    renderDialog({ record: makeRecord({ aiGrade: 'high', tags: ['工作'] }) });

    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('.record-detail-header');
    expect(header).toBeTruthy();
    // 头部固定：底边框分隔 + 不落在滚动区内
    expect(header!.className).toContain('border-b');
    // 关闭按钮不被全文滚动区包裹
    const closeBtn = screen.getByRole('button', { name: '关闭' });
    // 全文区：flex-1 + min-h-0 + overflow-y-auto，与 header 互为兄弟
    const scrollAreas = dialog.querySelectorAll('.overflow-y-auto');
    expect(scrollAreas.length).toBe(1);
    const scrollArea = scrollAreas[0];
    expect(scrollArea.className).toContain('flex-1');
    expect(scrollArea.className).toContain('min-h-0');
    expect(scrollArea.contains(header)).toBe(false);
    expect(header!.contains(scrollArea)).toBe(false);
    expect(scrollArea.contains(closeBtn)).toBe(false);
  });

  it('正文渲染 record.document 导出内容（RichCapturePreview 路径）', () => {
    renderDialog({
      record: makeRecord({
        document: JSON.stringify({
          root: {
            children: [
              { type: 'paragraph', children: [{ type: 'text', text: '弹窗里的正文' }] },
            ],
          },
        }),
      }),
    });
    expect(screen.getByText('弹窗里的正文')).toBeTruthy();
    // 展开态：无 max-h-40 限高、无渐变遮罩
    expect(document.querySelector('.max-h-40')).toBeNull();
    expect(document.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('document 为 null 时回退渲染 record.text', () => {
    renderDialog({ record: makeRecord({ document: null, text: '兜底纯文字' }) });
    expect(screen.getByText('兜底纯文字')).toBeTruthy();
  });

  it('元信息行含本地时间、级别徽标与标签 chips 配色（high→「高」+ bg-red-50）', () => {
    renderDialog({
      record: makeRecord({ aiGrade: 'high', tags: ['工作'] }),
      tagColors: { 工作: '#f59e0b' },
    });
    expect(
      screen.getByText(new Date('2024-05-01T08:30:00.000Z').toLocaleString()),
    ).toBeTruthy();
    const badge = screen.getByText('高');
    expect(badge.className).toContain('bg-red-50');
    expect(badge.className).toContain('rounded-full');
    const chip = screen.getByText('工作');
    expect(chip.style.backgroundColor).toBe('rgb(245, 158, 11)');
    // 亮底 → 深字（与 RecordRow chips 同款 tagTextColor 语义）
    expect(chip.style.color).toBe('rgb(31, 41, 55)');
  });

  it('mid/low 徽标分支：bg-neutral-100「中」与 border-neutral-200「低」', () => {
    const { container: midContainer } = renderDialog({ record: makeRecord({ aiGrade: 'mid' }) });
    const midBadge = screen.getByText('中');
    expect(midBadge.className).toContain('bg-neutral-100');
    cleanup();

    renderDialog({ record: makeRecord({ aiGrade: 'low' }) });
    const lowBadge = screen.getByText('低');
    expect(lowBadge.className).toContain('border-neutral-200');
    void midContainer;
  });

  it('aiGrade 为 null/undefined 时不渲染徽标', () => {
    const { container: nullContainer } = renderDialog({ record: makeRecord({ aiGrade: null }) });
    expect(nullContainer.textContent).not.toMatch(/[高中低]/);
    cleanup();

    const { aiGrade: _omit, ...withoutGrade } = makeRecord();
    void _omit;
    const { container: undefContainer } = renderDialog({ record: withoutGrade });
    expect(undefContainer.textContent).not.toMatch(/[高中低]/);
  });

  it('只读：不渲染复制/删除按钮', () => {
    renderDialog({ record: makeRecord({ imagePaths: ['images/a.png'] }) });
    expect(screen.queryByRole('button', { name: /复制记录/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除记录/ })).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import type { Tag } from '@shiguang/shared';
import type { ShiguangApi } from '../../../preload';
import { TagSelect } from './tag-select';

const TAG_LIB: Tag[] = [
  { id: 1, name: '工作', color: '#f59e0b' },
  { id: 2, name: '灵感', color: '#10b981' },
];

function createApiMock(): ShiguangApi {
  return {
    input: {
      blur: vi.fn(),
    },
  } as unknown as ShiguangApi;
}

/** 受控 harness：应用 onChange，模拟父级持有 value */
function Harness(props: RenderSelectProps) {
  const [value, setValue] = React.useState<string[]>(props.value ?? []);
  return (
    <TagSelect
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      tags={props.tags ?? TAG_LIB}
      onDeleteTag={props.onDeleteTag ?? (() => {})}
      allowCreate={props.allowCreate}
      allowDelete={props.allowDelete}
      onCreateTag={props.onCreateTag}
      placeholder={props.placeholder}
      aria-label={props['aria-label']}
    />
  );
}

type RenderSelectProps = Partial<Parameters<typeof TagSelect>[0]> & {
  tags?: Tag[];
  /** 外层容器 keydown 监听（验证 Esc stopPropagation 不冒泡） */
  onContainerKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
};

function renderSelect(props: RenderSelectProps = {}) {
  const onChange = vi.fn();
  render(
    <>
      {/* 容器级 keydown 监听：验证 Esc stopPropagation 不冒泡（capture-form 容器级 Esc 会收窗口） */}
      <div onKeyDown={props.onContainerKeyDown ?? (() => {})}>
        <Harness {...props} onChange={props.onChange ?? onChange} />
      </div>
    </>
  );
  return { onChange };
}

describe('TagSelect 标签多选', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('chips 实心底色取库色、文字色随底色亮度切换；库外名称灰底白字', () => {
    renderSelect({ value: ['工作', '旧标签'] });

    const chipInLib = screen.getByText('工作');
    expect(chipInLib.style.backgroundColor).toBe('rgb(245, 158, 11)');
    // 亮底（琥珀）→ 深字
    expect(chipInLib.style.color).toBe('rgb(31, 41, 55)');
    // × 按钮半透明白，hover 全白
    const removeBtn = screen.getByRole('button', { name: '移除标签 工作' });
    expect(removeBtn.className).toContain('text-white/70');
    expect(removeBtn.className).toContain('hover:text-white');

    const chipGhost = screen.getByText('旧标签');
    expect(chipGhost.style.backgroundColor).toBe('rgb(212, 212, 212)');
    // 灰底固定白字（已删/未命中语义，不走亮度判断）
    expect(chipGhost.style.color).toBe('rgb(255, 255, 255)');
  });

  it('点击输入框展开下拉，列出标签库全量项', async () => {
    const user = userEvent.setup();
    renderSelect();

    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(screen.getByRole('textbox', { name: '标签' }));

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('工作');
    expect(options[1].textContent).toContain('灵感');
    // 候选项为实心 mini-chip（底色 = tag.color，文字色随亮度）
    const miniChip = options[0].querySelector('span') as HTMLSpanElement;
    expect(miniChip.style.backgroundColor).toBe('rgb(245, 158, 11)');
    expect(miniChip.textContent).toContain('工作');
  });

  it('选项 onMouseDown 选中后入 chips、清空过滤文本且输入框未失焦（blur 时序铁律）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect({ onChange });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.change(input, { target: { value: '工' } });

    // mousedown + preventDefault：input 不丢焦，blur 不触发
    fireEvent.mouseDown(screen.getByRole('option', { name: /工作/ }));

    expect(onChange).toHaveBeenCalledWith(['工作']);
    // chips 行出现新 chip
    expect(screen.getByRole('button', { name: '移除标签 工作' })).toBeTruthy();
    // 过滤文本被清空
    expect(input).toHaveProperty('value', '');
    // 输入框保持焦点（activeElement 断言，未引入 jest-dom 无 toHaveFocus）
    expect(document.activeElement).toBe(input);
  });

  it('点 chip 的 × 调 onChange 剔除该项', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect({ value: ['工作', '灵感'], onChange });

    await user.click(screen.getByRole('button', { name: '移除标签 工作' }));

    expect(onChange).toHaveBeenCalledWith(['灵感']);
    // chips 行同步少一项（harness 应用了 onChange）
    expect(screen.queryByRole('button', { name: '移除标签 工作' })).toBeNull();
    expect(screen.getByRole('button', { name: '移除标签 灵感' })).toBeTruthy();
  });

  it('输入框为空时 Backspace 移除 value 最后一项；非空时不移除', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect({ value: ['工作', '灵感'], onChange });

    const input = screen.getByRole('textbox', { name: '标签' }) as HTMLInputElement;
    await user.click(input);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['工作']);
    expect(screen.queryByRole('button', { name: '移除标签 灵感' })).toBeNull();
  });

  it('blur 后下拉关闭，但绝不调 window.api.input.blur()（blur 铁律）', async () => {
    const user = userEvent.setup();
    const api = createApiMock();
    window.api = api;
    renderSelect();

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.blur(input);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(api.input.blur).not.toHaveBeenCalled();
  });

  it('输入过滤文本时下拉仅剩含该文本的项', async () => {
    const user = userEvent.setup();
    renderSelect();

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.change(input, { target: { value: '工' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('工作');
  });

  it('Enter 候选非空：选中第一项并清空过滤文本（下拉保持开）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect({ onChange });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.change(input, { target: { value: '工' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['工作']);
    expect(input).toHaveProperty('value', '');
    expect(screen.getByRole('listbox')).toBeTruthy();
    // 清空后下拉恢复全量
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('Enter 无候选且 allowCreate：调 onCreateTag，resolve 后入 chips 并清空文本', async () => {
    const user = userEvent.setup();
    const onCreateTag = vi.fn().mockResolvedValue({ id: 3, name: '新想法', color: '#ef4444' } as Tag);
    renderSelect({ onCreateTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.change(input, { target: { value: '新想法' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateTag).toHaveBeenCalledWith('新想法');
    // resolve 后 chip 入列、文本清空（onChange/setFilterText 在 then 回调内，异步落地）
    await screen.findByRole('button', { name: '移除标签 新想法' });
    expect(input).toHaveProperty('value', '');
  });

  it('Enter 无候选且 allowCreate：文本含首尾空格时以 trim 后名称新建', async () => {
    const user = userEvent.setup();
    const onCreateTag = vi.fn().mockResolvedValue({ id: 4, name: '工作', color: '#f59e0b' } as Tag);
    renderSelect({ onCreateTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    // ' 新 ' 无候选（库内无「新」）
    fireEvent.change(input, { target: { value: ' 新 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateTag).toHaveBeenCalledWith('新');
  });

  it('onCreateTag reject：静默吞错，不入 chips', async () => {
    const user = userEvent.setup();
    const onCreateTag = vi.fn().mockRejectedValue(new Error('标签名需为 1~20 字'));
    renderSelect({ onCreateTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.change(input, { target: { value: '新想法' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateTag).toHaveBeenCalledWith('新想法');
    // 等一个微任务周期确认 reject 被吞且未渲染 chip
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: '移除标签 新想法' })).toBeNull();
  });

  it('Enter 无候选：21 字文本直接忽略，不调 onCreateTag', async () => {
    const user = userEvent.setup();
    const onCreateTag = vi.fn();
    renderSelect({ onCreateTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.change(input, { target: { value: '长'.repeat(21) } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateTag).not.toHaveBeenCalled();
  });

  it('Enter 无候选且 allowCreate=false：忽略，不调 onCreateTag', async () => {
    const user = userEvent.setup();
    const onCreateTag = vi.fn();
    renderSelect({ allowCreate: false, onCreateTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.change(input, { target: { value: '新想法' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateTag).not.toHaveBeenCalled();
  });

  it('下拉项 ×：onDeleteTag 被调，正被选中的标签 chips 同步少一项（直删同步语义）', async () => {
    const user = userEvent.setup();
    const onDeleteTag = vi.fn().mockResolvedValue(undefined);
    renderSelect({ value: ['工作', '灵感'], onDeleteTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.mouseDown(screen.getByRole('button', { name: '删除标签 工作' }));

    expect(onDeleteTag).toHaveBeenCalledWith(TAG_LIB[0]);
    // 同步移除：harness 应用 onChange 后 chip 立即消失
    expect(screen.queryByRole('button', { name: '移除标签 工作' })).toBeNull();
    expect(screen.getByRole('button', { name: '移除标签 灵感' })).toBeTruthy();
  });

  it('下拉项 ×：标签未被选中时 chips 不变（仅调 onDeleteTag 删库）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDeleteTag = vi.fn().mockResolvedValue(undefined);
    renderSelect({ value: ['工作'], onChange, onDeleteTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    fireEvent.mouseDown(screen.getByRole('button', { name: '删除标签 灵感' }));

    expect(onDeleteTag).toHaveBeenCalledWith(TAG_LIB[1]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '移除标签 工作' })).toBeTruthy();
  });

  it('下拉项 ×：onDeleteTag reject 时选中项已同步移除且不抛错', async () => {
    const user = userEvent.setup();
    const onDeleteTag = vi.fn().mockRejectedValue(new Error('delete failed'));
    renderSelect({ value: ['工作'], onDeleteTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    // 不 await reject 的断言：同步语义下 chips 应立即少一项，随后 reject 被静默吞掉
    fireEvent.mouseDown(screen.getByRole('button', { name: '删除标签 工作' }));

    expect(screen.queryByRole('button', { name: '移除标签 工作' })).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    // 未选中崩溃/未渲染：组件依然健在，输入框保持焦点（blur 时序铁律未被破坏）
    expect(document.activeElement).toBe(input);
  });

  it('allowDelete 缺省：下拉项渲染删除按钮', async () => {
    const user = userEvent.setup();
    renderSelect();

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);

    expect(screen.getByRole('button', { name: '删除标签 工作' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除标签 灵感' })).toBeTruthy();
  });

  it('allowDelete=false：下拉项不渲染删除按钮，且项主体选中不受影响', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDeleteTag = vi.fn();
    renderSelect({ allowDelete: false, onChange, onDeleteTag });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);

    expect(screen.queryByRole('button', { name: '删除标签 工作' })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除标签 灵感' })).toBeNull();

    // 项主体选中行为不受影响（mousedown 选中，blur 时序铁律保持）
    fireEvent.mouseDown(screen.getByRole('option', { name: /工作/ }));
    expect(onChange).toHaveBeenCalledWith(['工作']);
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
    expect(onDeleteTag).not.toHaveBeenCalled();
  });

  it('Esc 只关下拉并 stopPropagation，不冒泡到容器', async () => {
    const user = userEvent.setup();
    const onContainerKeyDown = vi.fn();
    renderSelect({ onContainerKeyDown });

    const input = screen.getByRole('textbox', { name: '标签' });
    await user.click(input);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    // input 的 keydown 经容器 onKeyDown 处理并 stopPropagation，父容器监听未收到
    expect(onContainerKeyDown).not.toHaveBeenCalled();
  });
});

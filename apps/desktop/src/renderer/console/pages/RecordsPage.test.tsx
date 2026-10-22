// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryCapturesPayload } from '@shiguang/shared';
import type { Tag } from '@shiguang/shared';
import type { ShiguangApi } from '../../../preload';
import { RecordsPage } from './RecordsPage';

function makeRecords(total: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    text: `记录 ${i + 1}`,
    document: null,
    sourceApp: null,
    createdAt: '2024-05-01T08:30:00.000Z',
    imagePaths: [] as string[],
    tags: [] as string[],
  }));
}

/** 与组件同款的本地 datetime-local 格式化（'YYYY-MM-DDTHH:mm:ss'） */
function toLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** jsdom 回显归一化不统一（fireEvent 路径剥秒，React 赋值路径保留秒并补 .000），按分钟粒度比对 */
const echoMinute = (v: string) => v.slice(0, 16);

function createApiMock(total: number): ShiguangApi {
  const all = makeRecords(total);
  return {
    capture: {
      create: vi.fn(),
      list: vi.fn((payload: QueryCapturesPayload) => {
        const start = (payload.page - 1) * payload.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + payload.pageSize),
          total,
        });
      }),
      delete: vi.fn(() => Promise.resolve()),
      copyImage: vi.fn(),
    },
    console: {
      open: vi.fn(),
    },
    input: {
      blur: vi.fn(),
      close: vi.fn(),
    },
    pet: {
      clicked: vi.fn(),
      onSetState: vi.fn(() => () => {}),
    },
    tags: {
      list: vi.fn(() => Promise.resolve([] as Tag[])),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
      lastGet: vi.fn(() => Promise.resolve([] as string[])),
      lastSet: vi.fn(),
    },
  };
}

describe('RecordsPage 记录页', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('首屏按 page=1/pageSize=20 查询并渲染 20 条以内', async () => {
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    expect(await screen.findAllByRole('checkbox')).toHaveLength(20);
    expect(api.capture.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('存入时间按本地时区格式化显示', async () => {
    const api = createApiMock(1);
    window.api = api;
    render(<RecordsPage />);

    const expected = new Date('2024-05-01T08:30:00.000Z').toLocaleString();
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it('切换页码重新查询并渲染对应分页数据', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '下一页' }));

    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(await screen.findAllByRole('checkbox')).toHaveLength(5);
  });

  it('点击记录行展开显示全文，再次点击折叠回截断预览', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    const { container } = render(<RecordsPage />);

    const row = await screen.findByText('记录 1');
    const rowContainer = row.parentElement!;
    // 默认截断预览（预览容器限高 max-h-40 + 渐变遮罩）
    expect(row.closest('.max-h-40')).toBeTruthy();
    expect(row.closest('.relative')!.querySelector('.bg-gradient-to-t')).toBeTruthy();

    // 点击展开：移除限高与遮罩，全量展示
    await user.click(rowContainer);
    expect(row.closest('.max-h-40')).toBeNull();
    expect(row.closest('.relative')!.querySelector('.bg-gradient-to-t')).toBeNull();

    // 再次点击折叠回截断预览
    await user.click(rowContainer);
    expect(row.closest('.max-h-40')).toBeTruthy();
    expect(row.closest('.relative')!.querySelector('.bg-gradient-to-t')).toBeTruthy();
  });

  it('输入关键词触发带 keyword 的查询，并从当前页重置回第 1 页', async () => {
    const user = userEvent.setup();
    const api = createApiMock(45);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });

    await user.type(screen.getByRole('searchbox'), '拾光');

    expect(api.capture.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '拾光',
    });
  });

  it('类型筛选已移除：筛选区无「类型：」segmented，payload 不含 hasImages', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    // 记录均为图文混排形态，UI 不再渲染全部/文字/图片三选
    expect(screen.queryByRole('button', { name: '类型：全部' })).toBeNull();
    expect(screen.queryByRole('button', { name: '类型：图片' })).toBeNull();
    expect(screen.queryByRole('button', { name: '类型：文字' })).toBeNull();

    // 任意筛选操作后 payload 均不得携带 hasImages（DAO 查询能力保留但不再被页面调用）
    await user.type(screen.getByRole('searchbox'), '拾光');
    expect(api.capture.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '拾光',
    });
  });

  it('点「今天」预设给选择器赋值（本日零点~当前时刻）并触发带 since/until 的查询', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: '今天' }));
    const after = Date.now();

    // 预设是给选择器赋值：起止输入回显（jsdom 归一化不一，按分钟粒度断言）
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    expect(echoMinute((screen.getByLabelText('开始') as HTMLInputElement).value)).toBe(
      echoMinute(toLocalDateTime(midnight))
    );
    expect(echoMinute((screen.getByLabelText('结束') as HTMLInputElement).value)).toBe(
      echoMinute(toLocalDateTime(now))
    );
    // 「今天」预设高亮
    expect(
      (screen.getByRole('button', { name: '今天' }) as HTMLButtonElement).getAttribute('aria-pressed')
    ).toBe('true');

    const lastCall = vi.mocked(api.capture.list).mock.calls.at(-1)![0];
    expect(lastCall.page).toBe(1);
    expect(lastCall.pageSize).toBe(20);
    expect(lastCall.since).toBe(midnight.toISOString());
    // until 为点击时刻的本地时间（jsdom 把毫秒截为 .000，允许低 1s 的误差）
    const untilMs = new Date(lastCall.until!).getTime();
    expect(untilMs).toBeGreaterThanOrEqual(before - 1000);
    expect(untilMs).toBeLessThanOrEqual(after);
  });

  it('点「最近7天」预设给选择器赋值（7 天前~当前时刻）并触发带 since/until 的查询', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: '最近7天' }));
    const after = Date.now();

    // 选择器回显（jsdom 剥秒，按分钟粒度断言）
    const startInput = screen.getByLabelText('开始') as HTMLInputElement;
    const endInput = screen.getByLabelText('结束') as HTMLInputElement;
    const startMs = new Date(startInput.value).getTime();
    const endMs = new Date(endInput.value).getTime();
    expect(Math.abs(startMs - (before - 7 * 24 * 3600 * 1000))).toBeLessThanOrEqual(60_000);
    expect(endMs).toBeGreaterThanOrEqual(before - 60_000);
    expect(endMs).toBeLessThanOrEqual(after);

    const lastCall = vi.mocked(api.capture.list).mock.calls.at(-1)![0];
    expect(lastCall.page).toBe(1);
    expect(lastCall.pageSize).toBe(20);
    const sinceMs = new Date(lastCall.since!).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 7 * 24 * 3600 * 1000 - 60_000);
    expect(sinceMs).toBeLessThanOrEqual(after - 7 * 24 * 3600 * 1000);
    // until 为点击时刻的本地时间（jsdom 把毫秒截为 .000，允许低 1s 的误差）
    const untilMs = new Date(lastCall.until!).getTime();
    expect(untilMs).toBeGreaterThanOrEqual(before - 1000);
    expect(untilMs).toBeLessThanOrEqual(after);
  });

  it('关键词与时间预设可组合，「全部」清空选择器且不传 since/until', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: '最近30天' }));
    const after = Date.now();
    const lastCall = vi.mocked(api.capture.list).mock.calls.at(-1)![0];
    expect(lastCall.page).toBe(1);
    expect(lastCall.since).toBeTruthy();
    expect(Math.abs(new Date(lastCall.since!).getTime() - (before - 30 * 24 * 3600 * 1000))).toBeLessThan(2000);
    // until 为点击时刻的本地时间（jsdom 把毫秒截为 .000，允许低 1s 的误差）
    expect(new Date(lastCall.until!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(lastCall.until!).getTime()).toBeLessThanOrEqual(after);
    // 预设赋值后选择器有回显
    expect((screen.getByLabelText('开始') as HTMLInputElement).value).not.toBe('');

    await user.type(screen.getByRole('searchbox'), '会议纪要');
    const combinedCall = vi.mocked(api.capture.list).mock.calls.at(-1)![0];
    expect(combinedCall).toMatchObject({ page: 1, pageSize: 20, keyword: '会议纪要' });
    expect(combinedCall.since).toBeTruthy();
    expect(combinedCall.until).toBeTruthy();

    // 「全部」：清空选择器，payload 不再带 since/until，keyword 不受影响
    await user.click(screen.getByRole('button', { name: '全部' }));
    expect((screen.getByLabelText('开始') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('结束') as HTMLInputElement).value).toBe('');
    expect(api.capture.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '会议纪要',
    });
  });

  it('点击复制按钮将完整文本写入剪贴板并弹出轻提示', async () => {
    const user = userEvent.setup();
    const api = createApiMock(2);
    window.api = api;
    render(<RecordsPage />);
    // userEvent.setup() 会替换 navigator.clipboard 为自带 stub，此处 spy 其 writeText
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '复制记录 1' }));

    expect(writeText).toHaveBeenCalledWith('记录 1');
    expect(await screen.findByText('已复制到剪贴板')).toBeTruthy();
  });

  it('轻提示约 2 秒后自动消失', async () => {
    const api = createApiMock(1);
    window.api = api;
    render(<RecordsPage />);
    await screen.findAllByRole('checkbox');

    // fireEvent 同步派发，避开 userEvent 的定时器等待；fake timers 只包住自动消失断言段
    vi.useFakeTimers();
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
      fireEvent.click(screen.getByRole('button', { name: '复制记录 1' }));
      // 冲刷 writeText 的 promise 链，让 toast() 推送与 setTimeout 入队
      await act(async () => {});
      expect(screen.getByText('已复制到剪贴板')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText('已复制到剪贴板')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('展开一条不影响其他行的截断状态', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    const first = await screen.findByText('记录 1');
    const second = screen.getByText('记录 2');
    await user.click(first.parentElement!);

    expect(first.closest('.max-h-40')).toBeNull();
    expect(second.closest('.max-h-40')).toBeTruthy();
  });

  it('点击删除按钮弹出确认弹窗，取消则不删除且关闭弹窗', async () => {
    const user = userEvent.setup();
    const api = createApiMock(2);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '删除记录 1' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('确认删除该条记录？')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(api.capture.delete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('确认删除调用 capture.delete({ ids: [id] }) 并刷新当前页', async () => {
    const user = userEvent.setup();
    const api = createApiMock(2);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '删除记录 1' }));
    await user.click(screen.getByRole('button', { name: '确认' }));

    expect(api.capture.delete).toHaveBeenCalledWith({ ids: [1] });
    await waitFor(() => expect(api.capture.list).toHaveBeenCalledTimes(2));
    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('勾选多条记录后浮现操作栏，显示已选条数', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    expect(screen.queryByText(/已选 \d+ 条/)).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
    await user.click(screen.getByRole('checkbox', { name: '选择记录 2' }));

    expect(screen.getByText('已选 2 条')).toBeTruthy();
    expect(screen.getByRole('button', { name: '批量删除' })).toBeTruthy();
  });

  it('点击「取消」清空选择并隐藏操作栏', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
    expect(screen.getByText('已选 1 条')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText(/已选 \d+ 条/)).toBeNull();
    expect((screen.getByRole('checkbox', { name: '选择记录 1' }) as HTMLInputElement).checked).toBe(false);
  });

  it('点「批量删除」弹确认框，文案含已选条数', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
    await user.click(screen.getByRole('checkbox', { name: '选择记录 3' }));
    await user.click(screen.getByRole('button', { name: '批量删除' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('确认删除已选 2 条记录？')).toBeTruthy();
    expect(api.capture.delete).not.toHaveBeenCalled();
  });

  it('确认批量删除调用 capture.delete({ ids })，成功后清空选择并刷新', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
    await user.click(screen.getByRole('checkbox', { name: '选择记录 2' }));
    await user.click(screen.getByRole('button', { name: '批量删除' }));
    await user.click(screen.getByRole('button', { name: '确认' }));

    expect(api.capture.delete).toHaveBeenCalledWith({ ids: [1, 2] });
    // 成功后清空选择、关闭弹窗、隐藏操作栏，并重新查询当前页
    await waitFor(() => expect(api.capture.list).toHaveBeenCalledTimes(2));
    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/已选 \d+ 条/)).toBeNull();
  });

  it('批量删除把当前页删空且非第 1 页时回退到前一页重新查询', async () => {
    const user = userEvent.setup();
    const api = createApiMock(21);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(1);

    await user.click(screen.getByRole('checkbox', { name: '选择记录 21' }));
    await user.click(screen.getByRole('button', { name: '批量删除' }));
    await user.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() =>
      expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })
    );
  });

  it('当前页删空且非第 1 页时回退到前一页重新查询', async () => {
    const user = userEvent.setup();
    const api = createApiMock(21);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '删除记录 21' }));
    await user.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() =>
      expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })
    );
  });

  it('空库（无筛选条件且无结果）显示入库引导文案', async () => {
    const api = createApiMock(0);
    window.api = api;
    render(<RecordsPage />);

    expect(await screen.findByText('还没有任何记录')).toBeTruthy();
    expect(screen.getByText(/存入第一条记录/)).toBeTruthy();
    // 空库不显示筛选引导文案
    expect(screen.queryByText(/调整筛选/)).toBeNull();
  });

  it('切换每页条数触发带新 pageSize 的查询并回第 1 页', async () => {
    const user = userEvent.setup();
    const api = createApiMock(45);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });

    await user.selectOptions(screen.getByLabelText('每页条数'), '50');

    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
  });

  it('时间区间输入默认直接可见（无需先点「自定义」），填区间即以区间为准并取消预设高亮', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    // 平铺布局：起止输入与清空按钮首屏即渲染，无「自定义」收纳开关
    expect(screen.queryByRole('button', { name: '自定义' })).toBeNull();
    const startInput = screen.getByLabelText('开始');
    const endInput = screen.getByLabelText('结束');
    expect(screen.getByRole('button', { name: '清空时间区间' })).toBeTruthy();

    fireEvent.change(startInput, { target: { value: '2024-05-01T08:30:00' } });
    fireEvent.change(endInput, { target: { value: '2024-05-02T18:45:30' } });

    // jsdom 对 datetime-local 值会剥掉秒，期望 ISO 按输入实际回显值（本地时区显式构造）计算
    const toExpectedISO = (v: string) => {
      const [datePart, timePart = '00:00:00'] = v.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
      return new Date(year, month - 1, day, hour, minute, second).toISOString();
    };
    expect(api.capture.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      since: toExpectedISO((startInput as HTMLInputElement).value),
      until: toExpectedISO((endInput as HTMLInputElement).value),
    });
    // 区间生效时快捷预设不高亮
    expect(
      (screen.getByRole('button', { name: '全部' }) as HTMLButtonElement).getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('关键词与时间区间为同一表单值：分别变更后 payload 同时携带两者', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.type(screen.getByRole('searchbox'), '拾光');

    const startInput = screen.getByLabelText('开始');
    const endInput = screen.getByLabelText('结束');
    fireEvent.change(startInput, { target: { value: '2024-05-01T08:30:00' } });
    fireEvent.change(endInput, { target: { value: '2024-05-02T18:45:30' } });

    const toExpectedISO = (v: string) => {
      const [datePart, timePart = '00:00:00'] = v.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
      return new Date(year, month - 1, day, hour, minute, second).toISOString();
    };
    // 同一表单的 keyword + range 组合进同一个 payload，且重置回第 1 页
    expect(api.capture.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '拾光',
      since: toExpectedISO((startInput as HTMLInputElement).value),
      until: toExpectedISO((endInput as HTMLInputElement).value),
    });
  });

  it('手动改选择器值优先于预设（互斥），再点预设重新赋值（表单驱动）', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    const startInput = screen.getByLabelText('开始');
    fireEvent.change(startInput, { target: { value: '2024-05-01T08:30:00' } });
    expect((startInput as HTMLInputElement).value).toBe('2024-05-01T08:30');

    // 手动区间生效：快捷预设不高亮
    expect(
      (screen.getByRole('button', { name: '全部' }) as HTMLButtonElement).getAttribute('aria-pressed')
    ).toBe('false');

    const before = Date.now();
    await user.click(screen.getByRole('button', { name: '最近7天' }));
    const after = Date.now();

    // 预设生效：选择器被重新赋值、预设高亮、payload 走预设 since/until
    expect((startInput as HTMLInputElement).value).not.toBe('2024-05-01T08:30');
    expect((startInput as HTMLInputElement).value).not.toBe('');
    expect(
      (screen.getByRole('button', { name: '最近7天' }) as HTMLButtonElement).getAttribute('aria-pressed')
    ).toBe('true');
    const lastCall = vi.mocked(api.capture.list).mock.calls.at(-1)![0];
    expect(lastCall.page).toBe(1);
    const sinceMs = new Date(lastCall.since!).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 7 * 24 * 3600 * 1000 - 60_000);
    // until 为点击时刻的本地时间（jsdom 把毫秒截为 .000，允许低 1s 的误差）
    expect(new Date(lastCall.until!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(lastCall.until!).getTime()).toBeLessThanOrEqual(after);
  });

  it('点「清空时间区间」清空选择器且 payload 不再带 since/until', async () => {
    const user = userEvent.setup();
    const api = createApiMock(25);
    window.api = api;
    render(<RecordsPage />);

    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: '今天' }));
    const startInput = screen.getByLabelText('开始');
    expect((startInput as HTMLInputElement).value).not.toBe('');

    // 手动改起始时间：payload 以表单区间为准（end 保留预设赋的当前时刻）
    fireEvent.change(startInput, { target: { value: '2024-05-01T08:30:00' } });
    const customSince = new Date(2024, 4, 1, 8, 30, 0).toISOString();
    const rangeCall = vi.mocked(api.capture.list).mock.calls.at(-1)![0];
    expect(rangeCall).toMatchObject({ page: 1, pageSize: 20, since: customSince });
    expect(rangeCall.until).toBeTruthy();

    // 清空区间：选择器清空、payload 不带 since/until、「全部」高亮
    await user.click(screen.getByRole('button', { name: '清空时间区间' }));
    expect((startInput as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('结束') as HTMLInputElement).value).toBe('');
    expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(
      (screen.getByRole('button', { name: '全部' }) as HTMLButtonElement).getAttribute('aria-pressed')
    ).toBe('true');
  });

  describe('删除确认文案（任务 22）', () => {
    /** 混合类型记录：1 无图（纯文字）、2 含图（imagePaths 非空） */
    const mixedRecords = [
      { id: 1, text: '文字记录 1', document: null, sourceApp: null, createdAt: '2024-05-01T08:30:00.000Z', imagePaths: [] as string[], tags: [] as string[] },
      { id: 2, text: '', document: '{"root":{"children":[{"type":"paragraph","children":[{"type":"image","src":"images/a.png"}]}]}}', sourceApp: 'screenshot', createdAt: '2024-05-02T09:00:00.000Z', imagePaths: ['images/a.png'], tags: [] as string[] },
    ];

    function createMixedApiMock(): ShiguangApi {
      return {
        capture: {
          create: vi.fn(),
          list: vi.fn(() => Promise.resolve({ items: mixedRecords, total: mixedRecords.length })),
          delete: vi.fn(() => Promise.resolve()),
          copyImage: vi.fn(),
        },
        console: { open: vi.fn() },
        input: { blur: vi.fn(), close: vi.fn() },
        pet: { clicked: vi.fn(), onSetState: vi.fn(() => () => {}) },
        tags: {
          list: vi.fn(() => Promise.resolve([] as Tag[])),
          create: vi.fn(),
          rename: vi.fn(),
          delete: vi.fn(),
          lastGet: vi.fn(() => Promise.resolve([] as string[])),
          lastSet: vi.fn(),
        },
      };
    }

    it('对 image 行点删除，确认框 description 含「将同时删除图片文件」', async () => {
      const user = userEvent.setup();
      const api = createMixedApiMock();
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.click(screen.getByRole('button', { name: '删除记录 2' }));

      expect(screen.getByText('删除后不可恢复。将同时删除图片文件。')).toBeTruthy();
    });

    it('对 text 行点删除，确认框维持原文案不含扩展文案', async () => {
      const user = userEvent.setup();
      const api = createMixedApiMock();
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.click(screen.getByRole('button', { name: '删除记录 1' }));

      expect(screen.getByText('删除后不可恢复。')).toBeTruthy();
      expect(screen.queryByText(/将同时删除/)).toBeNull();
    });

    it('批量勾选混合集（含图片）时确认框含「将同时删除已选记录的图片文件」', async () => {
      const user = userEvent.setup();
      const api = createMixedApiMock();
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
      await user.click(screen.getByRole('checkbox', { name: '选择记录 2' }));
      await user.click(screen.getByRole('button', { name: '批量删除' }));

      expect(screen.getByText('删除后不可恢复。将同时删除已选记录的图片文件。')).toBeTruthy();
    });

    it('批量勾选纯文字集时确认框维持原文案', async () => {
      const user = userEvent.setup();
      const api = createMixedApiMock();
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.click(screen.getByRole('checkbox', { name: '选择记录 1' }));
      await user.click(screen.getByRole('button', { name: '批量删除' }));

      expect(screen.getByText('删除后不可恢复。')).toBeTruthy();
      expect(screen.queryByText(/将同时删除/)).toBeNull();
    });
  });

  describe('图片记录混合渲染（任务 23）', () => {
    /** 混合记录：1/3 纯文字，2/4 含图（imagePaths 非空） */
    const mixedRecords = [
      { id: 1, text: '文字记录 1', document: null, sourceApp: null, createdAt: '2024-05-01T08:30:00.000Z', imagePaths: [] as string[], tags: [] as string[] },
      { id: 2, text: '', document: '{"root":{"children":[{"type":"paragraph","children":[{"type":"image","src":"images/a.png"}]}]}}', sourceApp: 'screenshot', createdAt: '2024-05-02T09:00:00.000Z', imagePaths: ['images/a.png'], tags: [] as string[] },
      { id: 3, text: '文字记录 3', document: null, sourceApp: null, createdAt: '2024-05-03T10:00:00.000Z', imagePaths: [] as string[], tags: [] as string[] },
      { id: 4, text: '', document: '{"root":{"children":[{"type":"paragraph","children":[{"type":"image","src":"images/b.png"}]}]}}', sourceApp: 'screenshot', createdAt: '2024-05-04T11:00:00.000Z', imagePaths: ['images/b.png'], tags: [] as string[] },
    ];

    /** mock capture.list 恒返回混合记录（类型筛选已移除，payload 不再携带 hasImages） */
    function createMixedListApiMock(): ShiguangApi {
      return {
        capture: {
          create: vi.fn(),
          list: vi.fn(() => Promise.resolve({ items: mixedRecords, total: mixedRecords.length })),
          delete: vi.fn(() => Promise.resolve()),
          copyImage: vi.fn(),
        },
        console: { open: vi.fn() },
        input: { blur: vi.fn(), close: vi.fn() },
        pet: { clicked: vi.fn(), onSetState: vi.fn(() => () => {}) },
        tags: {
          list: vi.fn(() => Promise.resolve([] as Tag[])),
          create: vi.fn(),
          rename: vi.fn(),
          delete: vi.fn(),
          lastGet: vi.fn(() => Promise.resolve([] as string[])),
          lastSet: vi.fn(),
        },
      };
    }

    it('image 行与 text 行同屏渲染：文字预览与 shiguang-image:// 图片并存', async () => {
      const api = createMixedListApiMock();
      window.api = api;
      const { container } = render(<RecordsPage />);

      // text 行渲染文字预览
      expect(await screen.findByText('文字记录 1')).toBeTruthy();
      expect(screen.getByText('文字记录 3')).toBeTruthy();
      // image 行经 document 渲染协议图片（收起/展开形态一致）
      const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
      expect(imgs.map((i) => i.src)).toEqual([
        'shiguang-image://a.png',
        'shiguang-image://b.png',
      ]);
      expect(api.capture.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });

    it('image 行点删除的确认框扩展文案仍由 imagePaths 驱动（与 document 渲染无关）', async () => {
      const api = createMixedListApiMock();
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: '删除记录 2' }));

      expect(screen.getByText('删除后不可恢复。将同时删除图片文件。')).toBeTruthy();
    });
  });

  it('有筛选条件但无结果时显示调整筛选引导文案', async () => {
    const api = createApiMock(0);
    window.api = api;
    render(<RecordsPage />);

    await screen.findByText('还没有任何记录');
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), '拾光');

    expect(await screen.findByText('没有找到匹配的记录')).toBeTruthy();
    expect(screen.getByText(/调整关键词或时间范围/)).toBeTruthy();
    expect(screen.queryByText('还没有任何记录')).toBeNull();
  });

  describe('标签筛选（任务 18）', () => {
    const tagLib: Tag[] = [
      { id: 1, name: '工作', color: '#f59e0b' },
      { id: 2, name: '灵感', color: '#3b82f6' },
    ];

    function createTagsApiMock(total: number): ShiguangApi {
      const api = createApiMock(total);
      api.tags.list = vi.fn(() => Promise.resolve(tagLib));
      return api;
    }

    it('挂载时拉取标签库（tags:list 调用一次）', async () => {
      const api = createTagsApiMock(1);
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      expect(api.tags.list).toHaveBeenCalledTimes(1);
    });

    it('TagSelect 选择两个标签 → payload 含 tagNames 两元素且 page 归 1', async () => {
      const user = userEvent.setup();
      const api = createTagsApiMock(25);
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.click(screen.getByRole('button', { name: '下一页' }));
      expect(api.capture.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });

      // 点输入框展开下拉（blur 时序铁律：候选项 mousedown 选中，input 保持聚焦）
      await user.click(screen.getByRole('textbox', { name: '筛选标签' }));
      await user.click(screen.getByRole('option', { name: '工作' }));
      await user.click(screen.getByRole('option', { name: '灵感' }));

      expect(api.capture.list).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        tagNames: ['工作', '灵感'],
      });
    });

    it('移除全部标签 chips 后 payload 不再带 tagNames', async () => {
      const user = userEvent.setup();
      const api = createTagsApiMock(25);
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.click(screen.getByRole('textbox', { name: '筛选标签' }));
      await user.click(screen.getByRole('option', { name: '工作' }));
      expect(api.capture.list).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        tagNames: ['工作'],
      });

      await user.click(screen.getByRole('button', { name: '移除标签 工作' }));
      expect(api.capture.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    });

    it('标签筛选与关键词组合时两条件同在 payload', async () => {
      const user = userEvent.setup();
      const api = createTagsApiMock(25);
      window.api = api;
      render(<RecordsPage />);

      await screen.findAllByRole('checkbox');
      await user.type(screen.getByRole('searchbox'), '拾光');
      await user.click(screen.getByRole('textbox', { name: '筛选标签' }));
      await user.click(screen.getByRole('option', { name: '工作' }));

      expect(api.capture.list).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        keyword: '拾光',
        tagNames: ['工作'],
      });
    });

    it('仅有标签筛选但无结果时显示调整筛选引导文案', async () => {
      const user = userEvent.setup();
      const api = createTagsApiMock(0);
      window.api = api;
      render(<RecordsPage />);

      await screen.findByText('还没有任何记录');
      await user.click(screen.getByRole('textbox', { name: '筛选标签' }));
      await user.click(screen.getByRole('option', { name: '工作' }));

      expect(await screen.findByText('没有找到匹配的记录')).toBeTruthy();
      expect(screen.queryByText('还没有任何记录')).toBeNull();
    });
  });
});

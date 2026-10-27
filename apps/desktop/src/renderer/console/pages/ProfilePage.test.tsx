// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProfileDocument, ProfileStatusPayload, ProfileSummarizeResult } from '@shiguang/shared';
import type { ShiguangApi } from '../../../preload';
import { ProfilePage } from './ProfilePage';

/** 可变画像状态：模拟「summarize 成功后重新 get 拿到新状态」的真实链路 */
function createApiMock(initial: ProfileStatusPayload) {
  let status = initial;
  const inner = {
    get: vi.fn(() => Promise.resolve(status)),
    summarize: vi.fn(() => Promise.resolve<ProfileSummarizeResult>({ ok: true })),
  };
  const api = { profile: inner } as unknown as ShiguangApi;
  return {
    api,
    inner,
    setStatus(next: ProfileStatusPayload) {
      status = next;
    },
  };
}

const FULL_DOC: ProfileDocument = {
  identity: ['远程工作者'],
  recent: ['在搭拾光项目'],
  interests: ['摄影', '徒步'],
  values: ['重视家人陪伴'],
  goals: ['明年完成一次长途徒步'],
  misc: ['养了一只猫'],
};

const EMPTY_STATUS: ProfileStatusPayload = {
  document: null,
  updatedAt: null,
  pendingCount: 3,
  running: false,
};

const FULL_STATUS: ProfileStatusPayload = {
  document: FULL_DOC,
  updatedAt: '2026-10-27T08:00:00.000Z',
  pendingCount: 0,
  running: false,
};

describe('ProfilePage 画像页', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('挂载即调 profile:get', async () => {
    const { api, inner } = createApiMock(EMPTY_STATUS);
    window.api = api;
    render(<ProfilePage />);

    expect(inner.get).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('还没有生成过画像')).toBeTruthy();
  });

  it('updatedAt 为 null 显示「从未汇总」与空态引导文案', async () => {
    const { api } = createApiMock(EMPTY_STATUS);
    window.api = api;
    render(<ProfilePage />);

    expect(await screen.findByText('从未汇总')).toBeTruthy();
    expect(screen.getByText(/汇总 5 条以上记录摘要后自动生成画像/)).toBeTruthy();
  });

  it('六槽位非空内容按 身份概况/最近关注/兴趣爱好/在意的事/长期方向/其他 顺序渲染', async () => {
    const { api } = createApiMock(FULL_STATUS);
    window.api = api;
    render(<ProfilePage />);

    const headings = ['身份概况', '最近关注', '兴趣爱好', '在意的事', '长期方向', '其他'];
    for (const label of headings) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    // 文档序校验：每个标题都位于下一标题之前
    const elements = headings.map((label) => screen.getByText(label));
    for (let i = 0; i < elements.length - 1; i += 1) {
      expect(elements[i].compareDocumentPosition(elements[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // 条目内容随槽位渲染
    expect(screen.getByText('远程工作者')).toBeTruthy();
    expect(screen.getByText('养了一只猫')).toBeTruthy();
  });

  it('空槽位分区不渲染，非空槽位正常渲染', async () => {
    const sparse: ProfileStatusPayload = {
      ...FULL_STATUS,
      document: { identity: ['远程工作者'], recent: [], interests: [], values: [], goals: [], misc: ['养了一只猫'] },
    };
    const { api } = createApiMock(sparse);
    window.api = api;
    render(<ProfilePage />);

    expect(await screen.findByText('身份概况')).toBeTruthy();
    expect(screen.getByText('其他')).toBeTruthy();
    expect(screen.queryByText('最近关注')).toBeNull();
    expect(screen.queryByText('兴趣爱好')).toBeNull();
    expect(screen.queryByText('在意的事')).toBeNull();
    expect(screen.queryByText('长期方向')).toBeNull();
  });

  it('点「立即汇总」：busy 期间按钮禁用并调 profile:summarize，成功后重新 get 并渲染新内容', async () => {
    const user = userEvent.setup();
    const { api, inner, setStatus } = createApiMock(FULL_STATUS);
    let resolveSummarize: (value: ProfileSummarizeResult) => void = () => {};
    inner.summarize.mockReturnValue(
      new Promise<ProfileSummarizeResult>((resolve) => {
        resolveSummarize = resolve;
      })
    );
    window.api = api;
    render(<ProfilePage />);

    const button = await screen.findByRole('button', { name: '立即汇总' });
    await user.click(button);

    // busy 期间：按钮禁用、显示「汇总中…」、summarize 被调
    expect(inner.summarize).toHaveBeenCalledTimes(1);
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText('汇总中…')).toBeTruthy();
    expect(inner.get).toHaveBeenCalledTimes(1);

    // 汇总完成：状态推进（模拟主进程已写新画像），resolve 后页面重新 get 刷新
    setStatus({
      document: { ...FULL_DOC, misc: ['养了一只猫', '新条目'] },
      updatedAt: '2026-10-27T09:00:00.000Z',
      pendingCount: 0,
      running: false,
    });
    resolveSummarize({ ok: true });

    expect(await screen.findByText('新条目')).toBeTruthy();
    expect(inner.get).toHaveBeenCalledTimes(2);
    expect(button).toHaveProperty('disabled', false);
  });

  it('summarize 返回 { ok: false, error } 时 toast 展示 error', async () => {
    const user = userEvent.setup();
    const { api, inner } = createApiMock(FULL_STATUS);
    inner.summarize.mockResolvedValue({ ok: false, error: '汇总失败：网络错误' });
    window.api = api;
    render(<ProfilePage />);

    const button = await screen.findByRole('button', { name: '立即汇总' });
    await user.click(button);

    // Toaster 随页面挂载，toast 推送后直接渲染在 role=status 容器内
    expect(await screen.findByText('汇总失败：网络错误')).toBeTruthy();
    await waitFor(() => expect(inner.get).toHaveBeenCalledTimes(2));
  });

  it('running=true 时按钮禁用并显示「汇总中…」', async () => {
    const { api } = createApiMock({ ...FULL_STATUS, running: true });
    window.api = api;
    render(<ProfilePage />);

    const button = await screen.findByRole('button', { name: '立即汇总' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText('汇总中…')).toBeTruthy();
  });
});

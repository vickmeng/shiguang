/**
 * 画像页（ai-user-profile 任务 13）：只读展示 AI 用户画像——
 * 挂载调 profile:get 拉取 { document, updatedAt, pendingCount, running }；
 * 状态栏 = 上次汇总时间（本地格式化，无则「从未汇总」）+ 待汇总条数，
 * running（后台汇总中）或 busy（手动触发进行中）时显示「汇总中…」并禁用
 * 「立即汇总」按钮（前端按钮禁用是主进程单飞的展示侧双保险）；
 * 「立即汇总」click：busy 置位 → profile:summarize → 无论成败返回后重新
 * profile:get 刷新状态 → busy 复位；result.ok 为 false（或 invoke 本身
 * reject）时 toast 展示 error，可再次点击重试；
 * 内容区：document 为 null → 空态（引导文案「汇总 5 条以上记录摘要后
 * 自动生成画像」+「立即汇总」主按钮）；非 null → 按 SLOT_LABELS 固定顺序
 * 渲染 6 槽位分区（分区标题 + 条目 <ul>/<li> 列表），条目数组为空的分区
 * 不渲染（design 3.3 骨架第 8 条空槽隐藏）；整页只读，无任何编辑入口。
 */
import * as React from 'react';
import type { ProfileDocument, ProfileStatusPayload } from '@shiguang/shared';
import { toast, Toaster } from '../../components/ui/toast';

/** 槽位中文映射（顺序固定：身份概况/最近关注/兴趣爱好/在意的事/长期方向/其他） */
const SLOT_LABELS: Array<{ key: keyof ProfileDocument; label: string }> = [
  { key: 'identity', label: '身份概况' },
  { key: 'recent', label: '最近关注' },
  { key: 'interests', label: '兴趣爱好' },
  { key: 'values', label: '在意的事' },
  { key: 'goals', label: '长期方向' },
  { key: 'misc', label: '其他' },
];

export function ProfilePage(): JSX.Element {
  const [status, setStatus] = React.useState<ProfileStatusPayload | null>(null);
  // busy：手动「立即汇总」进行中（await summarize 期间），与 running（主进程后台汇总中）并列禁用按钮
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void window.api.profile.get().then(setStatus);
  }, []);

  /**
   * 手动触发汇总：busy 置位 → profile:summarize → 返回后重新 get 刷新 →
   * busy 复位；失败（ok:false 或 invoke reject）toast 展示 error，
   * 不阻塞刷新、可重试。
   */
  const handleSummarize = async () => {
    setBusy(true);
    try {
      const result = await window.api.profile.summarize();
      if (!result.ok) {
        toast(result.error ?? '汇总失败', 'destructive');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '汇总失败', 'destructive');
    } finally {
      setStatus(await window.api.profile.get());
      setBusy(false);
    }
  };

  const summarizeDisabled = busy || (status?.running ?? false);
  // 提取局部常量：属性窄化不随闭包保持（map 回调内直接 status.document 会报 possibly null）
  const document_ = status?.document ?? null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-neutral-800">画像</h1>
      {/* 状态栏：上次汇总时间 + 待汇总条数 + 汇总中态 + 手动触发按钮 */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
        <span className="text-neutral-600">
          上次汇总：
          <span>{status && status.updatedAt ? new Date(status.updatedAt).toLocaleString() : '从未汇总'}</span>
        </span>
        <span className="text-neutral-400">待汇总 {status?.pendingCount ?? 0} 条</span>
        {summarizeDisabled ? <span className="text-neutral-400">汇总中…</span> : null}
        <button
          type="button"
          disabled={summarizeDisabled}
          onClick={() => void handleSummarize()}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-white disabled:opacity-40"
        >
          立即汇总
        </button>
      </div>
      {status === null ? (
        <p className="text-sm text-neutral-400">加载中…</p>
      ) : document_ === null ? (
        /* 空态：从未汇总过（或坏画像 JSON 读侧降级为 null），引导 + 主按钮 */
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-neutral-600">还没有生成过画像</p>
          <p className="text-xs text-neutral-400">汇总 5 条以上记录摘要后自动生成画像</p>
          <button
            type="button"
            disabled={summarizeDisabled}
            onClick={() => void handleSummarize()}
            className="mt-2 rounded-md bg-neutral-800 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            立即汇总
          </button>
        </div>
      ) : (
        /* 6 槽位分区（顺序固定），空槽位不渲染 */
        SLOT_LABELS.map(({ key, label }) => {
          const items = document_[key];
          if (items.length === 0) return null;
          return (
            <section key={key} className="rounded-md border border-neutral-200 bg-white px-4 py-3">
              <h2 className="text-sm font-medium text-neutral-600">{label}</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {items.map((item, index) => (
                  <li key={index} className="text-sm text-neutral-700">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {/* 轻提示容器：汇总失败 error 在此弹出，约 2s 自动消失 */}
      <Toaster />
    </div>
  );
}

export default ProfilePage;

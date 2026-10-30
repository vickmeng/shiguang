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
 * 渲染 6 槽位分区（分区标题 + 描述文字段落），槽位为空（null/undefined/空串）
 * 的分区不渲染（design 3.3 骨架第 8 条空槽隐藏）；整页只读，无任何编辑入口。
 * 历史画像：挂载调 profile:history 拉取快照列表（id 倒序）；汇总成功重新
 * get 后同步刷新；底部「历史画像」表格——列为 版本（#id）/汇总时间/预览
 * （SLOT_LABELS 顺序首个非空槽位截断），行内 <details> 展开该版本完整
 * 非空槽位；无历史时显示空态文案。
 */
import * as React from 'react';
import type {
  ProfileDocument,
  ProfileHistoryEntry,
  ProfileStatusPayload,
} from '@shiguang/shared';
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

/** 历史条目预览：SLOT_LABELS 顺序首个非空槽位，截断至 40 字 */
function previewText(document: ProfileDocument): string {
  for (const { key } of SLOT_LABELS) {
    const value = document[key];
    if (value) {
      return value.length > 40 ? `${value.slice(0, 40)}…` : value;
    }
  }
  return '（空画像）';
}

export function ProfilePage(): JSX.Element {
  const [status, setStatus] = React.useState<ProfileStatusPayload | null>(null);
  // history：画像历史快照列表（profile:history，id 倒序）；null = 尚未加载
  const [history, setHistory] = React.useState<ProfileHistoryEntry[] | null>(null);
  // busy：手动「立即汇总」进行中（await summarize 期间），与 running（主进程后台汇总中）并列禁用按钮
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void window.api.profile.get().then(setStatus);
    void window.api.profile.history().then(setHistory);
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
      setHistory(await window.api.profile.history());
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
          const value = document_[key];
          if (!value) return null;
          return (
            <section key={key} className="rounded-md border border-neutral-200 bg-white px-4 py-3">
              <h2 className="text-sm font-medium text-neutral-600">{label}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{value}</p>
            </section>
          );
        })
      )}
      {/* 历史画像：每次汇总成功自动存档的快照表格（行内 details 展开完整槽位） */}
      <section className="rounded-md border border-neutral-200 bg-white px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-600">历史画像</h2>
        {history === null ? (
          <p className="mt-2 text-sm text-neutral-400">加载中…</p>
        ) : history.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">暂无历史画像，每次汇总成功会自动存档</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-neutral-400">
                <th className="py-1.5 pr-3 font-normal">版本</th>
                <th className="py-1.5 pr-3 font-normal">汇总时间</th>
                <th className="py-1.5 font-normal">内容</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-50 align-top">
                  <td className="py-2 pr-3 text-neutral-400">#{entry.id}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-neutral-600">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 text-neutral-700">
                    <details>
                      <summary className="cursor-pointer select-none">
                        {previewText(entry.document)}
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {SLOT_LABELS.map(({ key, label }) => {
                          const value = entry.document[key];
                          if (!value) return null;
                          return (
                            <div key={key}>
                              <span className="text-neutral-400">{label}：</span>
                              <span className="whitespace-pre-wrap">{value}</span>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {/* 轻提示容器：汇总失败 error 在此弹出，约 2s 自动消失 */}
      <Toaster />
    </div>
  );
}

export default ProfilePage;

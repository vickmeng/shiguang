/**
 * 画像汇总后台编排：触发判定（5 条 / 24h / 首跑）+ 手动触发入口，竞争态
 * 完全委托模块级 SingleFlightRunner 实例 summarizeJob（main/lib/singleFlight），
 * 本文件不留 running 标志与 lastAttemptAt 变量。
 *
 * 触发来源两类——capture 钩子（fire-and-forget）与定时器（任务 9 接线
 * startProfileTimer），均经 maybeSummarize() 收敛；手动入口 summarizeNow()
 * 供画像页「立即汇总」，running 中幂等返回 { ok: true }（前端按钮禁用双保险）。
 *
 * 「距上次」基准 = summarizeJob.getLastAttemptAt()（内存 epoch ms，含失败，
 * 进程重启即失）?? profiles.updated_at 转 epoch；从未汇总过（profiles 无行）
 * 且待汇总 ≥1 条即首跑。失败语义：队列不动、旧画像保留、console.error 留痕，
 * 绝不阻塞记录入库方。
 */
import {
  getProfile,
  pendingCount,
  pendingSummaries,
  runProfileSummarization,
  saveProfileWithStamp,
} from '@shiguang/ai';
import type { ProfileDocument, ProfileSummarizeResult } from '@shiguang/shared';
import { SingleFlightRunner } from '../lib/singleFlight';

/** 待汇总队列达到该条数即触发汇总（无视距上次间隔）。 */
const PENDING_TRIGGER_THRESHOLD = 5;

/** 距上次汇总尝试的最小间隔：24h（有积压时兜底触发）。 */
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 定时触发间隔：10 分钟（规则阈值为 5 条/24h，10min 粒度足够）。 */
const TIMER_INTERVAL_MS = 10 * 60 * 1000;

/** 业务语义层：竞争态 + 尝试计时委托本实例，双入口共用。 */
const summarizeJob = new SingleFlightRunner();

/** 汇总进行中态（profile:get 响应 running 字段，画像页据此禁用按钮）。 */
export function isRunning(): boolean {
  return summarizeJob.isRunning();
}

/**
 * 自动触发入口（capture 钩子 / 定时器）：只做判定不等待，满足规则即
 * fire-and-forget（void summarizeNow().catch(console.error)），不满足 return。
 *
 * 整体 try/catch 防 unhandled rejection；running 时快速短路（真正防线在
 * summarizeJob.run 内部的「检查→置位」原子段）。
 */
export function maybeSummarize(): void {
  try {
    if (summarizeJob.isRunning()) {
      return;
    }

    const pending = pendingCount();
    const now = Date.now();
    // 「距上次」基准：上次尝试（含失败）优先，进程重启后以 profiles.updated_at 续算
    const baseline = summarizeJob.getLastAttemptAt() ?? toEpoch(getProfile()?.updatedAt) ?? null;

    const due =
      pending >= PENDING_TRIGGER_THRESHOLD ||
      (baseline !== null && now - baseline >= RETRY_INTERVAL_MS && pending >= 1) ||
      (baseline === null && pending >= 1); // 从未汇总过：首跑

    if (!due) {
      return;
    }
    void summarizeNow().catch((e) => console.error(e));
  } catch (e) {
    console.error(e);
  }
}

/**
 * 手动触发入口（画像页「立即汇总」）：委托 summarizeJob.run 单飞执行。
 *
 * onBusy 为幂等 no-op 返回 { ok: true }（前端按钮已禁用双保险）；失败经
 * onError console.error 留痕并返回 { ok: false, error }，旧画像保留、
 * 队列不动，可手动重试。
 */
export function summarizeNow(): Promise<ProfileSummarizeResult> {
  return summarizeJob.run(doSummarize, {
    onBusy: () => ({ ok: true }),
    onError: (e) => {
      console.error('[profile] 汇总失败：', e);
      return { ok: false, error: e.message };
    },
  });
}

/**
 * 汇总本体：FIFO 待汇总批次 + 旧画像作为参考输入 → 全量重写出新画像 →
 * 单事务写画像并批量打时间戳（画像与打戳同生共死）。
 */
async function doSummarize(): Promise<ProfileSummarizeResult> {
  const batch = pendingSummaries();
  const previous: ProfileDocument | null = getProfile()?.document ?? null;
    const document = await runProfileSummarization({ previous, batch });
  saveProfileWithStamp({ document, stampedIds: batch.map((s) => s.recordId) });
  return { ok: true };
}

/**
 * 定时触发入口：每 10 分钟调一次 maybeSummarize()（其内部已有 try/catch 防
 * unhandled rejection，此处再兜一层）。不手动 clearInterval，跟随主进程
 * 生命周期（进程退出自然清理）。
 */
export function startProfileTimer(): void {
  setInterval(() => {
    try {
      maybeSummarize();
    } catch (e) {
      console.error(e);
    }
  }, TIMER_INTERVAL_MS);
}

/** ISO 字符串转 epoch ms；非法/缺失返回 null（基准判定按「从未汇总过」处理）。 */
function toEpoch(iso: string | undefined): number | null {
  if (!iso) {
    return null;
  }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * 记录页（任务 17/18/19）：骨架与列表渲染——
 * 挂载即分页查询（page=1/pageSize=20），每条渲染常驻复选框（勾选逻辑任务 22 接线）、
 * 多行截断预览（line-clamp-3）与本地时区格式化的存入时间；
 * 底部翻页控件按 total 计算页数，切换页码重新查询；
 * 点击记录行展开/折叠全文（expandedId 状态）；
 * 筛选区（任务 19）：关键词搜索框（受控输入，变更即重置 page=1 重新查询）
 * + 时间快捷预设四选（全部/今天/最近7天/最近30天，本地时区起算），两维可组合；
 * 类型筛选（任务 21）：全部/文字/图片三选，UI 语义不变（M4 任务 20 契约改造：
 * payload 不再传 type，image→hasImages:true / text→hasImages:false / 全部→缺省不传），
 * 与关键词/时间可组合。
 * 复制（任务 20）：每条记录常驻复制按钮，点击将完整 text 写入剪贴板
 * 并弹出自写 toast 轻提示（约 2s 自动消失）；
 * 单条删除（任务 21）：每条记录常驻删除按钮，点击弹自写 dialog 确认框，
 * 确认后调 window.api.capture.delete({ ids: [id] })；成功后处理页回退——
 * 当前页删空且 page>1 时 page-1 重新查询，否则当前页重新查询
 * （用 refreshTick 触发同 payload 重新查询）；
 * 删除确认文案的有图判断（M4 任务 20）：由 record.type === 'image' 改
 * record.imagePaths.length > 0（type 列已随迁移 0003 移除）；
 * 勾选与批量删除（任务 22）：复选框维护 selectedIds 集合，勾选数 ≥1 时
 * 顶部浮现操作栏（已选 N 条 / 批量删除 / 取消）；「批量删除」弹确认框
 * （文案含条数），确认后调 capture.delete({ ids: [...selectedIds] })，
 * 成功后清空选择并走与单删相同的页回退与刷新逻辑；
 * 空状态（任务 23）：空库（无筛选且无结果）显示入库引导文案，
 * 有筛选条件但无结果显示调整筛选引导文案，Tailwind 自写无第三方组件；
 * 记录页增强（任务 28）：分页条新增每页条数选择（10/20/50/100，默认 20，
 * 切换即重置 page=1 重新查询）；
 * 时间筛选布局重做（任务 30）：时间区间选择器直接平铺筛选区——
 * 自写 RangeTimePicker（起/止 datetime-local，step=1，精确到秒）always 可见，
 * 不做「自定义」收纳开关；
 * 筛选区接入 TanStack Form（任务 31）：keyword + 时间区间由
 * `@tanstack/react-form` 驱动（与输入框 capture-form 同一引擎，不引 zod），
 * RangeTimePicker 改造为受控字段组件（value/onChange），时间值唯一来源为表单；
 * 快捷预设（全部/今天/7天/30天）语义为「给选择器赋值并触发查询」——
 * 今天=[今日 00:00, 当前时刻]、7d/30d=[对应起点, 当前时刻]、全部=清空起止，
 * payload 一律从表单值换算（range.from/to 经 localDateTimeToISO 得 since/until），
 * 预设高亮仅存于 UI（activePreset），随手动区间变更互斥切换；
 * 变更均重置 page=1 重查。
 */
import * as React from 'react';
import type { QueryCapturesPayload, QueryCapturesResult } from '@shiguang/shared';
import { useForm, useStore } from '@tanstack/react-form';
import { Toaster } from '../../components/ui/toast';
import { ConfirmDialog } from '../../components/ui/dialog';
import { RangeTimePicker, type RangeValue } from '../../components/ui/range-time-picker';
import { RecordRow } from './RecordRow';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type TimePreset = 'all' | 'today' | '7d' | '30d';

/** 类型筛选（任务 21）：'all'=全部（缺省不传 hasImages），image/text 映射 hasImages true/false */
type CaptureTypeFilter = 'all' | 'text' | 'image';

const TYPE_FILTERS: Array<{ key: CaptureTypeFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文字' },
  { key: 'image', label: '图片' },
];

const TIME_PRESETS: Array<{ key: TimePreset; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: '7d', label: '最近7天' },
  { key: '30d', label: '最近30天' },
];

/** Date → 本地 'YYYY-MM-DDTHH:mm:ss'（datetime-local 值格式，秒对齐 step=1） */
function toLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 预设 → 选择器赋值（任务 31）：今天=[今日 00:00, 当前时刻]，
 * 7d/30d=[对应起点, 当前时刻]，全部={} 清空起止；
 * 均为本地 datetime-local 字符串，payload 由表单值统一换算。
 */
function presetToRange(preset: TimePreset): RangeValue {
  const now = new Date();
  if (preset === 'all') return {};
  const to = toLocalDateTime(now);
  if (preset === 'today') {
    return { from: toLocalDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate())), to };
  }
  if (preset === '7d') {
    return { from: toLocalDateTime(new Date(now.getTime() - 7 * 24 * 3600 * 1000)), to };
  }
  return { from: toLocalDateTime(new Date(now.getTime() - 30 * 24 * 3600 * 1000)), to };
}

/**
 * datetime-local 值为本地时间（'YYYY-MM-DDTHH:mm:ss'），
 * 显式按本地时区构造 Date（不依赖 new Date(string) 的浏览器解析差异），再转 ISO。
 */
function localDateTimeToISO(value: string): string {
  const [datePart, timePart = '00:00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  // datetime-local 值可能缺秒/缺分（如 jsdom 会剥掉秒），缺省补 0
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

export function RecordsPage() {
  const [page, setPage] = React.useState(1);
  // 每页条数（任务 28）：默认 20，切换即重置 page=1 重新查询
  const [pageSize, setPageSize] = React.useState(20);
  const [result, setResult] = React.useState<QueryCapturesResult>({ items: [], total: 0 });
  const [loading, setLoading] = React.useState(true);
  // 展开/折叠全文：保存当前展开行的 id，null 表示全部折叠
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  // 筛选表单（任务 31）：keyword + 时间区间，TanStack Form 驱动（同 capture-form 引擎）
  const form = useForm({
    defaultValues: {
      keyword: '',
      range: {} as RangeValue,
      type: 'all' as CaptureTypeFilter,
    },
  });
  // 表单值为筛选 payload 唯一来源：订阅 store values，变更即触发下方 effect 重查
  const filters = useStore(form.store, (state) => state.values);
  // 预设高亮（纯 UI 状态，不影响 payload）：点预设记录键，手动改区间互斥清除（null 表示无高亮）
  const [activePreset, setActivePreset] = React.useState<TimePreset | null>('all');
  // 删除确认弹窗（任务 21）：null 表示未弹出，否则为待删除记录 id
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  // 勾选集合（任务 22）：已选记录 id，勾选数 ≥1 时顶部浮现批量操作栏
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<number>>(new Set());
  // 批量删除确认弹窗（任务 22）
  const [batchDeleteOpen, setBatchDeleteOpen] = React.useState(false);
  // 同 payload 重新查询的信号（删除后当前页仍有数据时 +1 触发 effect 重查）
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // payload 一律从表单值换算：keyword 空串不放入 payload，
    // range.from/to 经 localDateTimeToISO 换算 since/until（含该秒）
    const payload: QueryCapturesPayload = { page, pageSize };
    if (filters.keyword) payload.keyword = filters.keyword;
    if (filters.range.from) payload.since = localDateTimeToISO(filters.range.from);
    if (filters.range.to) payload.until = localDateTimeToISO(filters.range.to);
    // 类型筛选（任务 21/M4 任务 20）：'all' 缺省不传 hasImages（后端返回全部），
    // image=仅含图 / text=仅无图（type 列已随迁移 0003 移除，改 hasImages 契约）
    if (filters.type === 'image') payload.hasImages = true;
    else if (filters.type === 'text') payload.hasImages = false;
    void window.api.capture.list(payload).then((data) => {
      if (cancelled) return;
      setResult(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, filters, refreshTick]);

  /** 类型筛选变更（任务 21）：写入表单并重置回第 1 页重新查询（表单值驱动 effect） */
  const handleTypeChange = (next: CaptureTypeFilter) => {
    form.setFieldValue('type', next);
    setPage(1);
  };

  /** 关键词变更即重置回第 1 页并重新查询（表单值驱动 effect） */
  const handleKeywordChange = (value: string) => {
    form.setFieldValue('keyword', value);
    setPage(1);
  };

  /**
   * 快捷预设（任务 31）：给选择器赋值（form.setFieldValue range）并触发查询——
   * 时间值唯一来源为表单，预设不再持有独立筛选状态。
   */
  const handlePresetChange = (next: TimePreset) => {
    setActivePreset(next);
    form.setFieldValue('range', presetToRange(next));
    setPage(1);
  };

  /**
   * 时间区间起止变更（RangeTimePicker 受控 onChange）：
   * 写入表单并互斥预设高亮——起止任一非空则不高亮任何预设，清空回落「全部」；
   * 重置回第 1 页重新查询。清空按钮等价于 onChange({})，同路径回落「全部」。
   */
  const handleRangeChange = (next: RangeValue) => {
    form.setFieldValue('range', next);
    setActivePreset(next.from || next.to ? null : 'all');
    setPage(1);
  };

  /**
   * 确认删除（任务 21）：调用删除接口成功后处理页回退——
   * 当前页仅余这一条（删空）且非第 1 页时回退前一页，否则当前页重查。
   */
  const handleConfirmDelete = () => {
    if (deletingId === null) return;
    const id = deletingId;
    setDeletingId(null);
    void window.api.capture.delete({ ids: [id] }).then(() => {
      if (result.items.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        setRefreshTick((tick) => tick + 1);
      }
      if (expandedId === id) setExpandedId(null);
    });
  };

  /** 勾选/取消勾选一条记录（任务 22） */
  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 确认批量删除（任务 22）：成功后清空选择并处理页回退——
   * 当前页所选即删空且非第 1 页时回退前一页，否则当前页重查。
   */
  const handleConfirmBatchDelete = () => {
    if (selectedIds.size === 0) return;
    // 先取选择集快照：下方 setSelectedIds(new Set()) 清空后，
    // 闭包内仍需用本次勾选的集合做页回退与展开态清理判断，
    // 避免「先 setState 后用旧值判断」的顺序敏感写法
    const selected = selectedIds;
    const ids = Array.from(selected);
    const deletedOnPage = result.items.filter((item) => selected.has(item.id)).length;
    setBatchDeleteOpen(false);
    setSelectedIds(new Set());
    void window.api.capture.delete({ ids }).then(() => {
      if (result.items.length === deletedOnPage && page > 1) {
        setPage(page - 1);
      } else {
        setRefreshTick((tick) => tick + 1);
      }
      if (expandedId !== null && selected.has(expandedId)) setExpandedId(null);
    });
  };

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  // 时间区间是否实际生效（起止任一非空），用于空状态文案的筛选条件判断
  const rangeInUse = filters.range.from !== undefined && filters.range.from !== ''
    || filters.range.to !== undefined && filters.range.to !== '';
  // 删除确认文案（任务 22/M4 任务 20）：待删记录含图（imagePaths 非空）时提示级联清理图片文件
  const deletingRecord = deletingId === null
    ? null
    : result.items.find((item) => item.id === deletingId) ?? null;
  const singleDeleteDescription = deletingRecord && deletingRecord.imagePaths.length > 0
    ? '删除后不可恢复。将同时删除图片文件。'
    : '删除后不可恢复。';
  // 勾选集含图片记录（以当前页 items 为准）时批量确认框提示级联清理已选图片文件
  const batchHasImage = result.items.some((item) => selectedIds.has(item.id) && item.imagePaths.length > 0);
  const batchDeleteDescription = batchHasImage
    ? '删除后不可恢复。将同时删除已选记录的图片文件。'
    : '删除后不可恢复。';

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-neutral-800">记录</h1>
      {/* 筛选区（任务 31）：TanStack Form 驱动，keyword + 时间区间两维可组合 */}
      <div className="flex flex-wrap items-center gap-3">
        <form.Field name="keyword">
          {(field) => (
            <input
              type="search"
              role="searchbox"
              aria-label="搜索关键词"
              placeholder="搜索关键词"
              value={field.state.value}
              onChange={(e) => handleKeywordChange(e.target.value)}
              className="w-64 rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
          )}
        </form.Field>
        <div className="flex items-center gap-1">
          {TIME_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={activePreset === p.key}
              onClick={() => handlePresetChange(p.key)}
              className={
                activePreset === p.key
                  ? 'rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white'
                  : 'rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600'
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* 类型筛选（任务 21）：全部/文字/图片三选（缺省=全部不传 hasImages），样式照时间预设 chips；
            aria-label 以「类型：」前缀与时间预设的「全部」区分 */}
        <div className="flex items-center gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-label={`类型：${t.label}`}
              aria-pressed={filters.type === t.key}
              onClick={() => handleTypeChange(t.key)}
              className={
                filters.type === t.key
                  ? 'rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white'
                  : 'rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* 时间区间选择（任务 30/31）：平铺 always 可见；受控字段组件，值唯一来源为表单 */}
      <form.Field name="range">
        {(field) => (
          <RangeTimePicker value={field.state.value} onChange={handleRangeChange} />
        )}
      </form.Field>
      {/* 批量操作栏（任务 22）：勾选数 ≥1 时浮现；取消清空选择并隐藏 */}
      {selectedIds.size >= 1 ? (
        <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
          <span className="text-neutral-600">已选 {selectedIds.size} 条</span>
          <button
            type="button"
            className="rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-500"
            onClick={() => setBatchDeleteOpen(true)}
          >
            批量删除
          </button>
          <button
            type="button"
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-neutral-600 hover:bg-neutral-100"
            onClick={() => setSelectedIds(new Set())}
          >
            取消
          </button>
        </div>
      ) : null}
      {/* 空状态（任务 23）：空库显示入库引导，有筛选但无结果显示调整筛选引导（条件取表单值） */}
      {!loading && result.total === 0 ? (
        filters.keyword !== '' || rangeInUse || filters.type !== 'all' ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
            <p className="text-sm font-medium text-neutral-600">没有找到匹配的记录</p>
            <p className="text-xs text-neutral-400">试试调整关键词或时间范围</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
            <p className="text-sm font-medium text-neutral-600">还没有任何记录</p>
            <p className="text-xs text-neutral-400">使用拾光快捷键存入第一条记录</p>
          </div>
        )
      ) : null}
      {result.items.length > 0 ? (
      <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
        {result.items.map((item) => (
          <RecordRow
            key={item.id}
            record={item}
            expanded={expandedId === item.id}
            selected={selectedIds.has(item.id)}
            onToggleExpand={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
            onToggleSelect={() => toggleSelected(item.id)}
            onDelete={() => setDeletingId(item.id)}
          />
        ))}
      </ul>
      ) : null}
      {loading ? <p className="text-sm text-neutral-400">加载中…</p> : null}
      <div className="flex items-center gap-3 text-sm text-neutral-500">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded-md border border-neutral-200 px-3 py-1 disabled:opacity-40"
        >
          上一页
        </button>
        <span>
          第 {page} / {totalPages} 页
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="rounded-md border border-neutral-200 px-3 py-1 disabled:opacity-40"
        >
          下一页
        </button>
        {/* 每页条数（任务 28）：切换即重置 page=1 重新查询 */}
        <label className="flex items-center gap-1">
          每页
          <select
            aria-label="每页条数"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded-md border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-neutral-400"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          条
        </label>
      </div>
      {/* 轻提示容器：复制成功等反馈在此弹出，约 2s 自动消失 */}
      <Toaster />
      {/* 单条删除确认弹窗（任务 21/22）：含图记录（imagePaths 非空）提示将同时删除图片文件，确认后删除并处理页回退 */}
      <ConfirmDialog
        open={deletingId !== null}
        title="确认删除该条记录？"
        description={singleDeleteDescription}
        confirmText="确认"
        confirmVariant="destructive"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingId(null)}
      />
      {/* 批量删除确认弹窗（任务 22）：文案含已选条数，勾选集含图片时提示级联清理图片文件 */}
      <ConfirmDialog
        open={batchDeleteOpen}
        title={`确认删除已选 ${selectedIds.size} 条记录？`}
        description={batchDeleteDescription}
        confirmText="确认"
        confirmVariant="destructive"
        onConfirm={handleConfirmBatchDelete}
        onCancel={() => setBatchDeleteOpen(false)}
      />
    </div>
  );
}

export default RecordsPage;

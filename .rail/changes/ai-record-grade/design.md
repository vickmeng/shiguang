# Design: 记录摘要分级（ai-record-grade）

## 1. 概述

拾光输入框「拾光」提交链路上，AI 段迭代一（ai-record-summary）已由 Mastra Agent 单步产出 `{ meaningful, summary }` 并存 `analyses` 表（1:1 records，同事务入库）。本次在同一次 LLM 调用内**额外产出三档分级 grade**（high/mid/low，即「AI 判重点」——`docs/REQUIREMENTS.md` MEM-02 画像权重的前置数据），随摘要入库；记录页由 `<ul>/<li>` 行卡片改为 `<table>` 表格（选择 | 时间 | 摘要 | 级别 | 标签 | 操作，无内容预览列），点击摘要弹新弹窗看图文全文（复用 RichCapturePreview expanded 渲染），行内 expand 机制整体移除，筛选区加级别下拉。

**范围内：**

- 迁移 0006_analyses_grade：`analyses` 表 `ADD COLUMN grade TEXT`（可空，无 CHECK，校验收敛应用层 zod）；down 直接用 `ALTER TABLE analyses DROP COLUMN grade`（better-sqlite3 ^12.11.1 内置 SQLite ≥3.35 支持，无需重建表）；登记进 db.ts migrations 数组（analysesMigration 之后）
- summarizer 扩展：`analysisOutputSchema` 加 `grade: z.enum(['high','mid','low']).optional()`；`SUMMARIZER_SYSTEM_PROMPT` 任务清单加第三项（判「对未来了解用户的价值」：观点/决定/计划/强情感/长期参考 → high；一般事实/日常 → mid；琐碎/一次性 → low；仅 meaningful=true 时输出）；`analyzeCapture` 返回判别联合类型带 grade
- 失败语义（两点区分）：grade **缺失**（AI 未返回）→ 不阻塞入库，存 NULL；grade **值非法**（如「高」）→ zod enum 校验失败 → Mastra 自然抛错走迭代一既有失败路径（整链失败不入库、图片清理、可重试），代码零新增分支
- shared 契约：`export type Grade = 'high' | 'mid' | 'low'`；`CaptureRecord` 加 `aiGrade?: Grade | null`；`QueryCapturesPayload` 加 `grade?: Grade`（缺省 = 全部）；IPC 通道不变
- DAO 扩展：RecordRow 加 `ai_grade`；共享 JOIN 模板带 `analyses.grade AS ai_grade`；`createCapture` RETURNING 补 `NULL AS ai_grade`；`createCaptureWithAttachments` 的 analysis 参数加 `grade?: Grade | null`、INSERT analyses 带 grade 列；`queryCaptures` 加 grade 单值过滤（子查询形态）；**不建第三份并存 DAO 接口**
- 记录页表格化：RecordRow 原地改造为 `<tr>`（复选框/时间/摘要/级别/标签/操作六个 td；摘要 td 整格可点击弹详情，两行截断）；级别徽标配色定稿（high 红 / mid 中性实底 / low 描边灰）；新组件 `record-detail-dialog.tsx`（console 域，遮罩模式复用 ConfirmDialog 版式，RichCapturePreview expanded 全文 + 时间/级别/标签元信息行，只读）；expand 状态与 props 整体移除
- 级别筛选：筛选区加 `<select>`（全部/高/中/低），进 TanStack Form 同一 effect 组合过滤

**范围外（不做）：**

- 人工改级 / 级别编辑入口（先靠轻量展示观察 AI 分级质量）
- 独立分级链路、多维/tag 式分级（仅三档枚举）
- 画像消费端（grade 聚合语义留给迭代二 design）
- 存量回填 / 重跑机制 / prompt_version 预埋（沿用既有技术债务条目）
- 新建存量清理逻辑（交付时一次性动作用现有 capture.delete 批量接口级联清空，不是产品功能、不写代码）
- ESC 键关闭弹窗（遮罩 + × 按钮关闭即可）

**边缘场景（已对齐）：**

| 场景 | 处理方式 |
| --- | --- |
| grade 值非法（如「高」而非 high） | zod enum 校验失败 → 整链失败不入库，图片清理，按钮失败态可重试（与摘要失败口径一致，无新增代码分支） |
| grade 缺失（AI 未返回） | 存 NULL 不阻塞；记录页级别 td 留空不渲染徽标；级别筛选不匹配该条（`grade = ?` 天然不匹配 NULL） |
| 摘要空/纯空白 | 维持迭代一既有口径：失败不入库 |
| 弹窗打开时该记录被删除 | 删除成功回调里 `if (detailId === id) setDetailId(null)`（单删/批删都处理），再走既有页回退逻辑 |
| 级别筛选下删除致当前页为空 | 复用既有页回退逻辑（page > 1 回退前一页），零改动 |
| 筛选空结果（含 grade 维度） | 复用「没有找到匹配的记录」空状态，条件判断增 `filters.grade !== ''` |
| 存量旧记录 | 交付时一次性清空（全选 id 走 capture.delete 级联），不做回填 |

## 2. 验收标准

测试策略：三层测试沿用——① DAO/迁移（临时目录真实 SQLite：0006 up/down、grade 写入读回、queryCaptures grade 过滤命中与 NULL 排除）；② summarizer 单测（vi.mock agent：grade 缺失通过、非法值拒绝、prompt 含第三任务）；③ ipc handler 测试（analysis 载荷带 grade 断言同步）与 renderer 组件测试（表格结构、摘要点击弹窗、级别徽标渲染、筛选下拉、expand 用例删除）+ 根 `pnpm typecheck` 三包。真机走查补验表格观感与弹窗交互。

- AC-1：分级产出——同一 summarizer 调用产出 `{ meaningful, summary?, grade? }`；meaningful=true 时摘要与 grade 随记录同事务入库；prompt 含第三任务（判「对未来了解用户的价值」，高/中/低判定标准）。
- AC-2：grade 缺失语义——AI 未返回 grade 时记录正常入库（grade = NULL），不阻塞链路；记录页该条不显示级别、级别筛选不匹配。
- AC-3：grade 非法语义——grade 值非法时 zod 校验失败，整链失败不入库，提交失败态可重试（与摘要失败口径一致）。
- AC-4：迁移正确——迁移 0006 后 analyses 表存在可空 grade TEXT 列；down 迁移（DROP COLUMN）可回滚；grade 不加 CHECK 约束。
- AC-5：契约——`CaptureRecord.aiGrade` 可选可空，不破坏旧 fixture；`Grade` 类型导出；`QueryCapturesPayload.grade` 缺省 = 全部。
- AC-6：查询过滤——queryCaptures 支持 grade 单值过滤且仅匹配非 NULL 记录；list 查询 LEFT JOIN 带出 aiGrade。
- AC-7：记录页表格化——列 = 选择/时间/摘要/级别/标签/操作；无内容预览列；点击摘要弹窗复用 RichCapturePreview expanded 展示图文全文（含时间/级别/标签）；行内 expand 机制已移除。
- AC-8：级别筛选——级别下拉（全部/高/中/低）与关键词/时间/标签在 TanStack Form 内组合过滤；筛选空结果复用既有空状态文案。
- AC-9：页回退——级别筛选下删除致当前页为空时回退前一页（复用既有逻辑）。
- AC-10：自动化测试全绿——`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过，不回退现有基线。
- AC-11：需求文档——`docs/REQUIREMENTS.md` 登记本次立项与交付（rail-docs 阶段或交付时更新）。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
/** AI 摘要分级（analyses.grade 三档枚举）：画像权重「AI 判重点」数据来源 */
export type Grade = 'high' | 'mid' | 'low';

export interface CaptureRecord {
  // ...既有字段不变，新增：
  /** AI 摘要分级（analyses.grade）；无分级（grade 为 NULL）的记录为 null/undefined */
  aiGrade?: Grade | null;
}

export interface QueryCapturesPayload {
  // ...既有字段不变，新增：
  /** 级别单值过滤（analyses.grade），缺省 = 全部；仅匹配非 NULL 记录 */
  grade?: Grade;
}
```

**packages/ai/src/analysis/summarizer.ts（扩展）**

```ts
/** structured output：grade 缺失（AI 未返回）通过 → 存 NULL；值非法 → zod 拒绝走失败路径 */
const analysisOutputSchema = z.object({
  meaningful: z.boolean(),
  /** meaningful=false 时缺省 */
  summary: z.string().optional(),
  /** 仅 meaningful=true 时输出；三档枚举，写进 zod description 供 LLM 对照 */
  grade: z.enum(['high', 'mid', 'low']).optional(),
});

export function analyzeCapture(input: {
  text: string;
  images: Array<{ filePath: string }>;
}): Promise<{ meaningful: true; summary: string; grade?: Grade } | { meaningful: false }>;
// meaningful=true：摘要空/纯空白校验沿用（抛错），grade 不做存在性强制（缺失即 undefined）
// meaningful=false：返回 { meaningful: false }（不带 summary/grade）
```

**packages/ai/src/dao/captureDao.ts（扩展，既有行为零改动）**

```ts
interface RecordRow {
  // ...既有字段不变，新增：
  /** LEFT JOIN analyses 得到的 AI 分级，grade 为 NULL 时为 null */
  ai_grade: string | null;
}

// SELECT_RECORDS_JOIN 的 SELECT 列表追加：analyses.grade AS ai_grade
// createCapture 的 RETURNING 追加：NULL AS ai_grade（沿用既有 NULL AS 模式）

export function createCaptureWithAttachments(input: {
  // ...既有字段不变，变更：
  /** AI 摘要与分级（缺省 = 不写 analyses 行）；grade 缺省/null 存 NULL，不阻塞入库 */
  analysis?: { summary: string; model: string; grade?: Grade | null };
}): CaptureRecord;
// INSERT 改为：INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, ?, ?)
//   参数：row.id, input.analysis.summary, input.analysis.model, input.analysis.grade ?? null

// queryCaptures 增 grade 过滤（子查询形态，total COUNT 与 items JOIN 共用同一 conditions/params）：
if (input.grade !== undefined) {
  conditions.push('records.id IN (SELECT record_id FROM analyses WHERE grade = ?)');
  params.push(input.grade);
}

// toRecord 映射：aiGrade: (row.ai_grade as Grade | null) ?? null
//（grade 合法性写入前已被 zod 保证，读出仅透传；Grade import 自 @shiguang/shared）
```

**apps/desktop 主进程（captureHandlers.ts）**

```ts
// capture:create 既有编排零结构改动，仅 analysis 载荷透传 grade：
analysis: { summary: analysis.summary, model: resolveKimiModel(), grade: analysis.grade ?? null },
// 无意义/空摘要/grade 非法分支完全沿用既有抛错 + 图片清理路径（AI_NOT_MEANINGFUL_MESSAGE / 原样 rethrow）
```

**apps/desktop renderer**

```ts
// RecordRow.tsx：原地改造为表格行（组件名不变，li→tr；props 删 expanded/onToggleExpand，增 onOpenDetail）
export interface RecordRowProps {
  record: CaptureRecord;
  selected: boolean;
  tagColors?: Record<string, string>;
  onToggleSelect(): void;
  onOpenDetail(): void;   // 摘要 td 点击回调（父级 setDetailId）
  onDelete(): void;
}

// record-detail-dialog.tsx（新建，console 域组件，不进 ui primitives）：
export interface RecordDetailDialogProps {
  open: boolean;
  record: CaptureRecord | null;   // null 或 open=false 返回 null
  tagColors?: Record<string, string>;
  onClose(): void;
}
export function RecordDetailDialog(props: RecordDetailDialogProps): JSX.Element | null;

// RecordsPage.tsx：detailId 状态替代 expandedId；筛选表单 defaultValues 增 grade: '' as '' | Grade
// payload 换算：if (filters.grade) payload.grade = filters.grade;
```

### 3.2 关键数据结构

**analyses 表 grade 列（迁移 0006 新增）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| grade | TEXT（可空，无 CHECK、无默认值） | AI 三档分级；NULL = AI 未返回 / 旧数据；写入前合法性由 zod enum 保证，读出仅透传 |

**迁移 0006（`packages/ai/src/migrations/0006_analyses_grade.ts`，沿用 0005 样板）**

- `const UP_SQL = 'ALTER TABLE analyses ADD COLUMN grade TEXT;'`
- `const DOWN_SQL = 'ALTER TABLE analyses DROP COLUMN grade;'`（better-sqlite3 ^12.11.1 内置 SQLite ≥3.35 支持 DROP COLUMN；proposal 中「重建表」备选作废）
- db.ts migrations 数组在 `analysesMigration` 之后登记

**级别徽标配色（设计定稿）**

| grade | 文案 | 配色 |
| --- | --- | --- |
| high | 高 | `bg-red-50 text-red-600` |
| mid | 中 | `bg-neutral-100 text-neutral-600` |
| low | 低 | `bg-transparent border border-neutral-200 text-neutral-400` |
| null | （不渲染） | td 留空 |

统一 `rounded-full px-2 py-0.5 text-xs`；弹窗元信息行复用同一徽标渲染逻辑。

**SUMMARIZER_SYSTEM_PROMPT 修订（第三任务追加 + JSON 格式行改写，其余逐字保留）**

```
任务：
1.（原第一项，不动）
2.（原第二项，不动）
3. 判定这条记录对未来了解用户的价值，输出三档分级之一：
   - high：观点、决定、计划、强烈情感、有长期参考价值的内容；
   - mid：一般事实、日常事务记录；
   - low：琐碎、一次性、过后即无参考价值的内容。
   仅当 meaningful=true 时输出分级。

严格输出 JSON：{"meaningful": true/false, "summary": "...", "grade": "high"|"mid"|"low"}
（不值得保存时省略 summary 与 grade）
```

zod description 同步写判定标准（`z.enum(['high','mid','low']).describe('观点/决定/计划/强情感/长期参考→high；一般事实/日常→mid；琐碎/一次性→low')`）。

### 3.3 关键骨架（必须按此实现）

1. grade 合法性的唯一防线是 zod enum（写入前）；DAO 读出仅透传不做二次校验；DB 不加 CHECK（与既有迁移风格一致）。
2. grade **缺失**与 grade **非法**严格区分：缺失（optional 通过）→ `grade ?? null` 存 NULL 不阻塞；非法 → schema 解析抛错走既有失败路径（无新增 catch/分支）。
3. `queryCaptures` 的 grade 过滤必须子查询形态：`records.id IN (SELECT record_id FROM analyses WHERE grade = ?)`——total COUNT 在 records 单表执行（既有架构，analyses 列无法直接引用），WHERE 与 COUNT 共用同一 conditions/params 保证两侧语义一致；`grade = ?` 天然不匹配 NULL。
4. `SELECT_RECORDS_JOIN` 增 `analyses.grade AS ai_grade`；`createCapture` 的 RETURNING 同步补 `NULL AS ai_grade`（沿用既有 `NULL AS image_path, NULL AS ai_summary` 模式），两处与 RecordRow 接口同改，禁止漂移。
5. RecordRow 为 `<tr>`，六个 td 列序固定：选择（复选框）| 时间 | 摘要 | 级别 | 标签 | 操作；摘要 td 为整格可点击 button 语义（text-left、line-clamp-2），aiSummary 为 null/undefined 时渲染占位「—」且不可点击；tr 无整行点击，操作按钮不再需要 stopPropagation。
6. expand 机制整体移除：RecordsPage 删 `expandedId`/`setExpandedId`，RecordRow 删 `expanded`/`onToggleExpand` props；`RichCapturePreview` 的 `expanded` prop 保留（仅弹窗传 `true`）。
7. 弹窗数据直接用当前列表行的 record 对象（列表已带全量字段），**不新增 IPC 查询**；open=false 或 record=null 返回 null；遮罩模式沿用 ConfirmDialog（fixed inset-0 z-50、半透明遮罩点击关闭、role="dialog" aria-modal）。
8. 删除成功回调（单删/批删两处）均处理 `if (detailId === id / selected.has(detailId)) setDetailId(null)`，再走既有页回退逻辑；页回退、删除确认文案、批量操作栏、分页控件零改动。

### 3.4 数据流 / 状态变更

```
【capture:create（主进程，既有编排不变）】
writeImageFiles → analyzeCapture → { meaningful: true, summary, grade? }
  → handler：analysis: { summary, model: resolveKimiModel(), grade: analysis.grade ?? null }
  → createCaptureWithAttachments 单事务：INSERT records → attachments × N
    → INSERT analyses (record_id, summary, model, grade) → return CaptureRecord
  → grade 非法/空摘要/无意义：zod 或 handler 抛错 → 清理 written 图片 → invoke reject（既有路径）

【capture:list → queryCaptures】
payload.grade（可选）→ conditions 子查询 → total COUNT（records 单表，同 conditions）
  → items SELECT LEFT JOIN analyses（ai_grade）→ toRecords 聚合 → CaptureRecord.aiGrade

【记录页（RecordsPage）】
挂载/筛选变更 → capture.list(payload) → <table> 渲染 RecordRow × N
  → 摘要 td 点击 → setDetailId(id) → RecordDetailDialog(open, record, tagColors)
  → RichCapturePreview(document, text, expanded=true) 全文 + 元信息行（时间/级别徽标/标签 chips）
  → 删除成功（单/批）→ detailId 命中则置 null → 页回退/refreshTick 重查

【级别筛选】
<select>（值 '' | 'high' | 'mid' | 'low'）→ TanStack Form grade 字段 → 同一 effect
  → filters.grade 非空时 payload.grade = filters.grade → 重置 page=1 重查
```

### 3.5 技术决策

1. **[新增] grade 入 analyses 加列（ALTER ADD COLUMN），不建关联表、不拆列**。理由：analyses 与 records 已 1:1（record_id PK），grade 是摘要的同级属性，加可空列是最小扩展；关联表为多对多错配。无 CHECK、无默认值：分级校验收敛应用层 zod enum（既有迁移风格），写入前已保证合法，读出仅透传。
2. **[新增] down 直接用 `ALTER TABLE analyses DROP COLUMN grade`，不重建表**。理由：proposal 中「重建表去列」备选基于「SQLite ALTER 不支持 DROP COLUMN」的旧认知；better-sqlite3 ^12.11.1 内置 SQLite ≥3.35（2021-03 起支持 DROP COLUMN），一行 DDL 即可，重建表需复制数据 + 重建 FK/索引，无谓复杂度与风险。
3. **[新增] grade 缺失与非法采用「optional + 天然失败」双语义，不加应用层分支**。理由：缺失不阻塞（存 NULL）与非法严格失败（整链失败可重试）是 proposal 明确对齐的两点；zod `.optional()` 精确表达「缺失通过、非法拒绝」，Mastra structured output 解析失败自然抛错，与迭代一摘要失败口径完全同构，代码零新增 catch。
4. **[新增] queryCaptures 的 grade 过滤用子查询形态，不用 JOIN WHERE 直写**。理由：total 的 COUNT 在 records 单表执行（既有架构，analyses 列无法直接在 COUNT 里引用）；JOIN 查询的 WHERE 与 COUNT 共用同一 conditions/params，子查询 `records.id IN (SELECT ... WHERE grade = ?)` 两侧语义一致且 `grade = ?` 天然不匹配 NULL（AC-2 筛选不匹配无分级记录）。备选 JOIN 后 HAVING/COUNT 重写：破坏既有 total/items 共用 conditions 结构，排除。
5. **[新增] 分级收敛进既有 summarizer 一次调用，不建独立分级链路**。理由：proposal 明确「不做过多判断」、一次调用同出 `{ meaningful, summary, grade }`；独立链路 doubles LLM 成本与延迟，且摘要与分级同上下文判定质量更稳。
6. **[沿用] grade 写入收敛进 `createCaptureWithAttachments`，不建 analysisDao / 第三份 DAO 接口**。理由：与迭代一同一决策（摘要与记录同事务边界）；技术债务约束明确勿制造第三份并存 DAO。
7. **[新增] 记录页表格化选择原地改造 RecordRow（li→tr），不新建 RecordTable 第二套行组件**。理由：行渲染逻辑（复选框/时间/摘要/标签 chips/操作按钮）全部沿用，仅容器语义从卡片变为表格行；新建第二套组件造成渲染逻辑双份漂移，违反单一事实来源。表头 sticky、列宽 time 固定 whiteSpace-nowrap、操作列固定宽即可，不做复杂布局。
8. **[新增] 摘要详情用新弹窗组件 + RichCapturePreview expanded，不新增 IPC 查询、不动 RichCapturePreview**。理由：弹窗数据直接用列表行 record（列表已 LEFT JOIN 带全量字段），新增查询是多余 round trip；RichCapturePreview 仅 RecordRow 消费过（输入框是 Lexical 编辑器不消费），其 expanded prop 保留给弹窗即满足全文渲染，组件本身零改动。
9. **[新增] 弹窗打开时记录被删除 → 删除回调同步关弹窗**。理由：弹窗引用当前列表行对象，删除后该对象过期（虽渲染无害，但语义上已不存在）；在既有删除成功回调内 `setDetailId(null)`（单删按 id、批删按 selected.has 判断）是最小处理，与既有页回退同位置，不引入新订阅。
10. **[沿用] 级别徽标为纯展示 Tailwind 类，不进 tagColorMap / 色板体系**。理由：级别是固定三档枚举语义色（定稿见 3.2），非用户数据，与标签动态色体系正交；映射文案 高/中/低 就地常量。
11. **[沿用] 级别筛选进 TanStack Form 同一表单与 effect**。理由：keyword/range/tags 已表单驱动（任务 31 口径），grade 同路径进 filters → payload，组合过滤与 page=1 重置语义自动一致；select 不包 form.Field 也可以，但值必须进 filters 走同一 effect。
12. **[沿用] IPC 通道不变**：grade 随 capture:list 的 CaptureRecord 与 payload 传递，preload/env.d.ts 零改动。

### 3.6 风险 / 取舍

- [风险] **grade 缺失率偏高导致级别列大面积留空** → 缓解：prompt 第三任务判定标准明确（进 zod description），仅观察期可接受；如缺失率不可接受属 prompt 调优（独立常量，不动链路）。
- [风险] **AI 分级质量不稳定（误判 high/low）** → 接受：本期为观察期 + 画像前置数据，人工改级入口明确不做（proposal 范围边界）；聚合语义留给迭代二 design 时可再校准。
- [取舍] **grade 非法即整链失败（提交不可入库）** → 接受：与迭代一摘要失败口径一致（proposal 已对齐），zod enum 是唯一防线，失败可重试；LLM 输出英文枚举在 prompt 明示后违规概率低。
- [风险] **better-sqlite3 版本漂移导致 DROP COLUMN 不可用** → 缓解：依赖锁版本 ^12.11.1（内置 SQLite ≥3.35），DAO 迁移测试断言 down 后列消失（AC-4）；若升级破坏，重建表备选仍在（proposal 原方案）。
- [取舍] **存量记录 grade 全 NULL 的视觉破窗** → 接受：交付时一次性清空存量（现有批量删除接口级联，非产品功能）；不做回填/重跑。
- [风险] **表格化改造回归（行点击/冒泡/分页/筛选用例）** → 缓解：组件测试全量重写覆盖表格结构（AC-7/AC-8），expand 相关用例随机制删除；操作按钮不再需要 stopPropagation 后相关断言同步移除。
- [风险] **弹窗渲染 RichCapturePreview 全文的长记录性能** → 接受：单条弹窗、只读、max-h-[80vh] overflow-y-auto，量级与迭代一 expand 展开态相同。

### 3.7 技术债务

- **记录编辑联动重跑**（既有条目延伸）：未来引入编辑后，grade 与摘要同样失配——编辑功能立项时须把「编辑触发重跑」作为其需求一部分，本期不预留 prompt_version。
- **prompt 调优无重跑机制**（沿用 `.rail/docs/ai/README.md` 既有条目）：prompt 修订后旧 grade 不升级，届时单独立项做重跑工具并补加 prompt_version 字段。
- **`listCaptures` 与 `queryCaptures` 并存**（既有债务）：本次 grade 数据访问收敛进既有接口，未新增第三份，统一治理仍待存储治理迭代。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：新增 `export type Grade = 'high' | 'mid' | 'low'`；`CaptureRecord` 增 `aiGrade?: Grade | null`；`QueryCapturesPayload` 增 `grade?: Grade`

**packages/ai/**
- `src/migrations/0006_analyses_grade.ts`（新建）：ADD/DROP COLUMN grade TEXT
- `src/db.ts`：migrations 数组登记 0006（analysesMigration 之后）
- `src/dao/captureDao.ts`：RecordRow 增 `ai_grade`；SELECT_RECORDS_JOIN 与 createCapture RETURNING 带 grade；`createCaptureWithAttachments` analysis 参数与 INSERT 带 grade；`toRecord` 映射 aiGrade；`queryCaptures` 增 grade 子查询过滤
- `src/analysis/summarizer.ts`：`analysisOutputSchema` 加 grade enum；`SUMMARIZER_SYSTEM_PROMPT` 加第三任务 + JSON 格式行改写；`analyzeCapture` 返回判别联合带 grade
- 测试：`src/db.test.ts`（0006 up/down 断言）、`src/dao/captureDao.test.ts`（grade 写入读回/缺省 NULL/过滤命中与 NULL 排除）、`src/analysis/summarizer.test.ts`（grade 缺失通过/非法拒绝/prompt 第三任务）

**apps/desktop 主进程**
- `src/main/ipc/captureHandlers.ts`：capture:create 的 analysis 载荷透传 `grade: analysis.grade ?? null`（编排结构零改动）
- 测试：`src/main/ipc/captureHandlers.test.ts`（DAO 入参带 grade 断言同步）

**apps/desktop renderer**
- `src/renderer/console/pages/RecordRow.tsx`：原地改造为表格行（六个 td、摘要点击弹详情、级别徽标、删 expand props）
- `src/renderer/console/pages/record-detail-dialog.tsx`（新建）：摘要详情弹窗（遮罩模式 + RichCapturePreview expanded + 元信息行）
- `src/renderer/console/pages/RecordsPage.tsx`：`<ul>/<li>` 改 `<table>`、detailId 状态、删 expandedId、级别筛选 select + payload 换算 + 空状态条件
- 测试：`RecordRow.test.tsx` 与 `RecordsPage.test.tsx` 重写（表格结构、弹窗、徽标、筛选；expand 用例删除；fixture 补 aiGrade）

**docs**
- `docs/REQUIREMENTS.md`：登记本次立项与交付（rail-docs 阶段或交付时更新，AC-11）

## 4. 回滚条件

- AI 分级质量不可接受（误判率高、缺失率高且 prompt 调优无效）→ 产品重议分级口径；数据层（迁移 0006、DAO 扩展）独立成立无害（可空列），UI 回退为不渲染级别列/筛选项即可，链路与表格化其余部分保留。
- better-sqlite3 升级后 DROP COLUMN 不可用（迁移 down 失败）→ DAO 迁移测试（AC-4）会即时暴露；届时将 0006 down 改为重建表方案（proposal 原备选），业务代码不动。
- 表格化/弹窗交互在真机走查出现不可接受的可用性问题 → 优先修 RecordsPage/RecordRow/record-detail-dialog 三组件（变更面收敛在 renderer 记录页）；数据层与 AI 链路不回滚。
- zod enum 严格失败导致提交失败率异常升高 → 先调 prompt（独立常量）；产品若重议「非法降级为 NULL」口径，仅需 schema 加 `.catch(null)` 级联调整，数据层不动。

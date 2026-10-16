import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../input/lib/utils';

/**
 * 自写 RangeTimePicker 时间区间选择 primitive（任务 30，任务 31 改造为表单受控）：
 * 起/止两个 datetime-local 输入（step=1，精确到秒）+ 清空按钮，always 可见，
 * 直接平铺在筛选区（不做「自定义」收纳开关）；
 * 受控字段组件（value/onChange）：起止值唯一来源为调用方表单（TanStack Form），
 * 清空按钮等价于 onChange({})，互斥/预设语义由调用方编排。
 */

export interface RangeValue {
  /** 起始时间（datetime-local 原始字符串，本地时间），缺省/空串表示未填 */
  from?: string;
  /** 结束时间（datetime-local 原始字符串，本地时间），缺省/空串表示未填 */
  to?: string;
}

const rangeTimeInputVariants = cva(
  'rounded-md border px-2 py-1 text-sm outline-none focus:border-neutral-400',
  {
    variants: {
      variant: {
        default: 'border-neutral-200'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface RangeTimePickerProps {
  /** 起止值（datetime-local 原始字符串，本地时间），由调用方表单持有 */
  value: RangeValue;
  /** 起止变更：清空按钮等价于 onChange({}) */
  onChange: (next: RangeValue) => void;
  /** 起始输入的 label / aria-label，默认「开始」 */
  startLabel?: string;
  /** 结束输入的 label / aria-label，默认「结束」 */
  endLabel?: string;
  className?: string;
  inputVariant?: VariantProps<typeof rangeTimeInputVariants>['variant'];
}

export function RangeTimePicker({
  value,
  onChange,
  startLabel = '开始',
  endLabel = '结束',
  className,
  inputVariant = 'default'
}: RangeTimePickerProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-sm text-neutral-600', className)}>
      <label className="flex items-center gap-1">
        {startLabel}
        <input
          type="datetime-local"
          step={1}
          aria-label={startLabel}
          value={value.from ?? ''}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className={cn(rangeTimeInputVariants({ variant: inputVariant }))}
        />
      </label>
      <label className="flex items-center gap-1">
        {endLabel}
        <input
          type="datetime-local"
          step={1}
          aria-label={endLabel}
          value={value.to ?? ''}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className={cn(rangeTimeInputVariants({ variant: inputVariant }))}
        />
      </label>
      <button
        type="button"
        aria-label="清空时间区间"
        onClick={() => onChange({})}
        className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
      >
        清空
      </button>
    </div>
  );
}

RangeTimePicker.displayName = 'RangeTimePicker';

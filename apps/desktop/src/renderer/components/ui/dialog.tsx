import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../input/lib/utils';

/**
 * 自写 dialog 确认弹窗 primitive（任务 21）：
 * 半透明遮罩 + 居中卡片 + 确认/取消按钮；
 * 由调用方以 `open` 控制显隐，遮罩点击与「取消」等价；
 * 受控组件，不内置状态，便于与页面各自的状态管理对齐。
 */

const dialogActionVariants = cva(
  'rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none',
  {
    variants: {
      variant: {
        default: 'bg-neutral-800 text-white hover:bg-neutral-700',
        destructive: 'bg-red-600 text-white hover:bg-red-500'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** 确认按钮文案，默认「确认」 */
  confirmText?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string;
  /** 确认按钮样式：删除等不可逆操作用 destructive */
  confirmVariant?: VariantProps<typeof dialogActionVariants>['variant'];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  confirmVariant = 'default',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 半透明遮罩：点击视为取消 */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-80 rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
        {description ? <p className="mt-2 text-sm text-neutral-500">{description}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(dialogActionVariants({ variant: confirmVariant }))}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

ConfirmDialog.displayName = 'ConfirmDialog';

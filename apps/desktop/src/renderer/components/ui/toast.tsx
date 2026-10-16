import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../input/lib/utils';

/**
 * 自写 toast 轻提示 primitive（任务 20）：
 * `toast(message)` 任意位置调用，`<Toaster />` 挂在页面根部统一渲染；
 * 每条提示约 2s 后自动消失。模块级订阅列表，多实例 Toaster 会各收一份，
 * 约定单页只挂一个 Toaster。
 */

const toastVariants = cva(
  'pointer-events-auto rounded-md px-3 py-2 text-sm text-white shadow-md',
  {
    variants: {
      variant: {
        default: 'bg-neutral-800',
        destructive: 'bg-red-600'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface ToastItem {
  id: number;
  message: string;
  variant?: VariantProps<typeof toastVariants>['variant'];
}

/** 提示自动消失时长（ms），任务约定约 2s */
export const TOAST_DURATION = 2000;

let nextToastId = 0;
const listeners = new Set<(item: ToastItem) => void>();

/** 弹出一条轻提示；返回该条 id（便于测试或手动撤下） */
export function toast(message: string, variant?: ToastItem['variant']): number {
  const item: ToastItem = { id: ++nextToastId, message, variant };
  listeners.forEach((listener) => listener(item));
  return item.id;
}

export interface ToasterProps extends React.HTMLAttributes<HTMLDivElement> {}

/** 轻提示渲染容器：接收 toast() 推送的条目，逐条倒计时自动消失 */
export function Toaster({ className, ...props }: ToasterProps) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    const handler = (item: ToastItem) => {
      setItems((current) => [...current, item]);
      setTimeout(() => {
        setItems((current) => current.filter((t) => t.id !== item.id));
      }, TOAST_DURATION);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2',
        className
      )}
      {...props}
    >
      {items.map((item) => (
        <div key={item.id} className={cn(toastVariants({ variant: item.variant }))}>
          {item.message}
        </div>
      ))}
    </div>
  );
}

Toaster.displayName = 'Toaster';

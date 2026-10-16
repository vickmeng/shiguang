/**
 * 后台 console 左侧导航栏（任务 14）：渲染「记录」「设置」两个导航项——
 * 点击切换 App.tsx 下发的 onSelect；选中项高亮。
 * 导航结构一次成型，后续迭代只加项不改编排。
 */
import * as React from 'react';
import { cn } from '../../input/lib/utils';

export type ConsolePage = 'records' | 'settings';

const NAV_ITEMS: { key: ConsolePage; label: string }[] = [
  { key: 'records', label: '记录' },
  { key: 'settings', label: '设置' },
];

export interface SideNavProps {
  selected: ConsolePage;
  onSelect: (page: ConsolePage) => void;
}

export function SideNav({ selected, onSelect }: SideNavProps) {
  return (
    <nav className="flex w-48 shrink-0 flex-col border-r border-neutral-200 bg-white p-3">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelect(item.key)}
          className={cn(
            'rounded-md px-3 py-2 text-left text-sm',
            selected === item.key
              ? 'bg-neutral-100 font-medium text-neutral-800'
              : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700',
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export default SideNav;

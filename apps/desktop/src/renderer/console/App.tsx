/**
 * 后台 console 装配层（任务 13）：只做装配——
 * 整窗 h-screen 左右布局：左侧固定宽导航栏 + 右侧内容区。
 * 当前选中页状态在此用 useState 管理，导航项由 <SideNav />（任务 14）渲染，
 * 「记录」页由 <RecordsPage />（任务 17）渲染，「设置」页由 <SettingsPage />（任务 15）渲染。
 */
import * as React from 'react';
import { SideNav, type ConsolePage } from './components/SideNav';
import RecordsPage from './pages/RecordsPage';
import TagsPage from './pages/TagsPage';
import SettingsPage from './pages/SettingsPage';

export function App() {
  const [page, setPage] = React.useState<ConsolePage>('records');

  return (
    <div className="flex h-screen bg-neutral-50">
      {/* 左侧固定宽导航栏 */}
      <SideNav selected={page} onSelect={setPage} />
      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto">
        {page === 'records' ? <RecordsPage /> : page === 'tags' ? <TagsPage /> : <SettingsPage />}
      </main>
    </div>
  );
}

export default App;

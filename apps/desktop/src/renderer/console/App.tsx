/**
 * 后台 console 装配层：只做装配——
 * 整窗 h-screen 左右布局：左侧固定宽导航栏 + 右侧内容区。
 * 当前选中页状态在此用 useState 管理，导航项由 <SideNav /> 渲染，
 * 页面分发走模块级 PAGES 映射（Record<ConsolePage, React.ComponentType>，
 * 键强制齐全——ConsolePage 增删页面时漏页/多页由 typecheck 编译期暴露），
 * 渲染处 `const Page = PAGES[page]; <Page />`，不再用三元链。
 */
import * as React from 'react';
import { SideNav, type ConsolePage } from './components/SideNav';
import RecordsPage from './pages/RecordsPage';
import TagsPage from './pages/TagsPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';

/** 页面分发映射：ConsolePage 每个键对应一个页面组件，键齐全由 Record 强制 */
const PAGES: Record<ConsolePage, React.ComponentType> = {
  records: RecordsPage,
  tags: TagsPage,
  profile: ProfilePage,
  settings: SettingsPage,
};

export function App() {
  const [page, setPage] = React.useState<ConsolePage>('records');
  const Page = PAGES[page];

  return (
    <div className="flex h-screen bg-neutral-50">
      {/* 左侧固定宽导航栏 */}
      <SideNav selected={page} onSelect={setPage} />
      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto">
        <Page />
      </main>
    </div>
  );
}

export default App;

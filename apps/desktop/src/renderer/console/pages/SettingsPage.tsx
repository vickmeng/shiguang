/**
 * 设置页占位（任务 15）。
 *
 * 仅为后台 console 的「设置」导航提供空态落地页——
 * 标题 + 空态说明文案，不实现任何实际设置项。
 * TODO: M3 开机自启 / M9 导出等设置项在此填充
 */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-neutral-800">设置</h1>
      {/* TODO: M3 开机自启 / M9 导出等设置项在此填充 */}
      <p className="text-sm text-neutral-400">设置项即将到来，敬请期待。</p>
    </div>
  );
}

export default SettingsPage;

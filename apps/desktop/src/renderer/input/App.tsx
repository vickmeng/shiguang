/**
 * 输入框装配层（任务 18）：只做装配——
 * 宽约 360px 的卡片容器（Tailwind 圆角白底浮窗观感）渲染 <CaptureForm />，
 * 右上角常驻关闭按钮（input.close 收起窗口；置于装配层而非表单内，
 * 使「✓ 已拾光」成功态下也可关闭）。
 */
import { X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { CaptureForm } from './features/capture/capture-form';

export function App() {
  return (
    // pt-10：为右上角绝对定位的关闭按钮（top-2 + h-7 = 36px）留出空间，避免遮挡 textarea
    <div className="relative w-[360px] rounded-xl border border-neutral-200 bg-white px-4 pb-4 pt-10 shadow-lg">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="关闭"
        onClick={() => window.api.input.close()}
        className="absolute right-2 top-2 h-7 w-7 text-neutral-400 hover:text-neutral-600"
      >
        <X className="h-4 w-4" />
      </Button>
      <CaptureForm />
    </div>
  );
}

export default App;

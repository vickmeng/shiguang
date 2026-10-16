/**
 * 拾光输入表单（任务 17）。
 *
 * 行为契约：
 * - textarea 原生 maxlength=5000，实时字数统计 `当前字数/5000`（口径随原生 maxlength，emoji 不单独计数）
 * - value.length === 0（不 trim）时提交按钮禁用；全空格/换行视为有内容
 * - 提交反馈收敛在提交按钮上（不替换整表内容）：idle「拾光」→ submitting「拾光中…」
 *   → success「✓ 已拾光」/ error「提交失败」，成功/失败态闪现后自动回到 idle 可录态；
 *   成功回 idle 时清空内容（已入库，准备下一条）；失败保留内容供重试。窗口不自动收起。
 * - 粘贴含文件/图片时 preventDefault 并提示「暂不支持」
 * - 容器级 Esc 调 input.close()；textarea blur 不主动调 input.blur()——
 *   否则点击「拾光」按钮的 mousedown 先触发 blur 同步收起窗口，click 落不到按钮。
 *   收起由主进程 inputWindow 的窗口级原生 blur 事件承担（焦点离开整个输入框窗口才触发），
 *   preload 的 input.blur() 仅作预留口子保留。
 */
import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';

const MAX_LENGTH = 5000;
/** 成功/失败态展示时长（操作确认闪现惯例 0.4~0.8s），之后自动回到可录态 */
const STATUS_RESET_DELAY_MS = 600;

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export function CaptureForm() {
  const [status, setStatus] = React.useState<SubmitStatus>('idle');
  const [pasteHint, setPasteHint] = React.useState<string | null>(null);
  const statusTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    },
    [],
  );

  const form = useForm({
    defaultValues: { text: '' },
    onSubmit: async ({ value, formApi }) => {
      setStatus('submitting');
      try {
        await window.api.capture.create({ text: value.text });
        setStatus('success');
        statusTimerRef.current = window.setTimeout(() => {
          formApi.reset();
          setStatus('idle');
        }, STATUS_RESET_DELAY_MS);
      } catch {
        // 失败保留内容供重试，2 秒后回到可录态
        setStatus('error');
        statusTimerRef.current = window.setTimeout(() => {
          setStatus('idle');
        }, STATUS_RESET_DELAY_MS);
      }
    },
  });

  const busy = status !== 'idle';

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      setPasteHint('暂不支持');
    }
  };

  return (
    <div
      className="flex w-full flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          window.api.input.close();
        }
      }}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="text">
          {(field) => (
            <Textarea
              autoFocus
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => {
                field.handleBlur();
              }}
              onPaste={handlePaste}
              maxLength={MAX_LENGTH}
              disabled={busy}
              placeholder="记下此刻…"
              className="min-h-[120px] resize-none"
            />
          )}
        </form.Field>
        <div className="flex h-4 items-center justify-between text-xs text-neutral-400">
          <span aria-live="polite">{pasteHint}</span>
          <form.Subscribe selector={(state) => state.values.text}>
            {(text) => (
              <span>
                {text.length}/{MAX_LENGTH}
              </span>
            )}
          </form.Subscribe>
        </div>
        <form.Subscribe selector={(state) => state.values.text}>
          {(text) => (
            <Button
              type="submit"
              disabled={text.length === 0 || busy}
              className={`w-full ${
                status === 'success'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-600'
                  : status === 'error'
                    ? 'bg-red-500 text-white hover:bg-red-500'
                    : ''
              }`}
            >
              {status === 'submitting'
                ? '拾光中…'
                : status === 'success'
                  ? '✓ 已拾光'
                  : status === 'error'
                    ? '提交失败'
                    : '拾光'}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}

export default CaptureForm;

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { InitialConfigType } from '@lexical/react/LexicalComposer';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  $nodesOfType,
  ParagraphNode,
  TextNode,
  type LexicalEditor,
} from 'lexical';
import type { ShiguangApi } from '../../../../preload';
import { AI_NOT_MEANINGFUL_MESSAGE } from '@shiguang/shared';
import { Toaster } from '../../../components/ui/toast';
import { CaptureForm, CaptureFormInner } from './capture-form';
import { $createImageNode, ImageNode } from './image-node';

// jsdom 缺口：Lexical discrete update 的选区对齐会调 Range.getBoundingClientRect
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () => ({}) as DOMRect;
  Range.prototype.getClientRects = () => ({}) as unknown as DOMRectList;
}

function createApiMock() {
  const api: ShiguangApi = {
    capture: {
      create: vi.fn().mockResolvedValue({
        id: 1,
        text: '',
        imagePaths: [],
        sourceApp: null,
        createdAt: new Date().toISOString(),
      }),
      list: vi.fn(),
      delete: vi.fn(),
      copyImage: vi.fn(),
    },
    tags: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
      lastGet: vi.fn().mockResolvedValue([]),
      lastSet: vi.fn().mockResolvedValue(undefined),
    },
    console: {
      open: vi.fn(),
    },
    profile: {
      get: vi.fn(),
      summarize: vi.fn(),
      history: vi.fn(),
    },
    input: {
      blur: vi.fn(),
      close: vi.fn(),
    },
    pet: {
      clicked: vi.fn(),
      onSetState: vi.fn(() => () => {}),
    },
  };
  return api;
}

const initialConfig: InitialConfigType = {
  namespace: 'shiguang-capture',
  nodes: [ParagraphNode, TextNode, ImageNode],
  onError: (error: Error) => {
    throw error;
  },
  theme: {},
};

/** 以内层组件 + 自有 Composer 渲染，测试可直接拿到编辑器实例做 update/断言 */
function renderInner(): { current: LexicalEditor | null } {
  const editorRef: { current: LexicalEditor | null } = { current: null };
  function EditorProbe() {
    const [editor] = useLexicalComposerContext();
    editorRef.current = editor;
    return null;
  }
  render(
    <LexicalComposer initialConfig={initialConfig}>
      <CaptureFormInner />
      <EditorProbe />
    </LexicalComposer>,
  );
  return editorRef;
}

function setEditorText(editor: LexicalEditor, text: string) {
  act(() => {
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode().append($createTextNode(text)));
      },
      { discrete: true },
    );
  });
}

function editorText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

const originalCreateObjectURL = URL.createObjectURL;

/** jsdom 无 ClipboardEvent/DataTransfer 实现，构造最小 clipboardData 形状 */
function makeClipboardData(init: { files?: File[]; text?: string }): DataTransfer {
  const files = init.files ?? [];
  const types = [
    ...(files.length > 0 ? ['Files'] : []),
    ...(init.text !== undefined ? ['text/plain'] : []),
  ];
  return {
    files,
    types,
    getData: (type: string) => (type === 'text/plain' ? (init.text ?? '') : ''),
  } as unknown as DataTransfer;
}

function dispatchPaste(target: Element, clipboardData: DataTransfer) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  target.dispatchEvent(event);
}

/**
 * jsdom 的 File/Blob 无 arrayBuffer()，粘贴分流仅消费 type + arrayBuffer()，
 * 用最小 stub 代替真实 File
 */
function makeImageFileStub(bytes: Uint8Array): File {
  return {
    type: 'image/png',
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  } as unknown as File;
}

/** TagSelect 的 filter input 同为 textbox 角色，编辑器 DOM 用 Lexical 标记唯一定位 */
function editorElement(): HTMLElement {
  return document.querySelector('[data-lexical-editor="true"]') as HTMLElement;
}

/** 捕获 Blob 构造入参（jsdom Blob 无 arrayBuffer，读回字节须拦截构造） */
function captureBlobParts(): { parts: BlobPart[][] } {
  const captured: BlobPart[][] = [];
  const OriginalBlob = globalThis.Blob;
  class BlobCapture extends OriginalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      captured.push(parts ?? []);
      super(parts, options);
    }
  }
  vi.stubGlobal('Blob', BlobCapture);
  return { parts: captured };
}

function mockCreateObjectURL(urls: string[]) {
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${urls.length + 1}`;
    urls.push(url);
    return url;
  }) as unknown as typeof URL.createObjectURL;
}

describe('CaptureForm（Lexical 形态）', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('无 useForm 残留：源码不引用 @tanstack/react-form，编辑器经 LexicalComposer 挂载', () => {
    const source = readFileSync('src/renderer/input/features/capture/capture-form.tsx', 'utf8');
    expect(source).not.toContain('@tanstack/react-form');
    expect(source).not.toContain('Textarea');
    expect(source).toContain('LexicalComposer');
  });

  it('编辑器挂载（contentEditable）', () => {
    window.api = createApiMock();
    render(<CaptureForm />);

    // jsdom 未实现 contentEditable IDL 属性，断言 contenteditable 属性值
    // （placeholder 与字数统计展示已于 2026-10-20 按产品决策移除，无相关断言）
    expect(editorElement().getAttribute('contenteditable')).toBe('true');
  });

  // jsdom 的 InputEvent 无 getTargetRanges()，Lexical 在 jsdom 不注册 beforeinput
  // 监听（CAN_USE_BEFORE_INPUT=false），真实键入路径不可模拟；改用编辑器实例
  // 直接 update 验证「输入 → editorState」链路，真机键入由任务 22 走查。
  it('编辑器可输入文字（编辑器实例 update 路径）', () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, '拾光');

    expect(editorText(editor)).toBe('拾光');
  });

  it('零长度禁用提交，全空格视为有内容可提交', () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    const submit = screen.getByRole('button', { name: /拾光/ });
    expect(submit).toHaveProperty('disabled', true);

    setEditorText(editor, '  ');
    expect(submit).toHaveProperty('disabled', false);

    setEditorText(editor, '');
    expect(submit).toHaveProperty('disabled', true);
  });

  it('超 5000 字回退 prevEditorState：第 5001 字被丢弃', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, 'a'.repeat(5000));
    expect(editorText(editor).length).toBe(5000);

    act(() => {
      editor.update(
        () => {
          // 在既有 5000 字段落上追加第 5001 个字符
          const paragraph = $getRoot().getFirstChild();
          if ($isParagraphNode(paragraph)) {
            paragraph.append($createTextNode('b'));
          }
        },
        { discrete: true },
      );
    });

    // 超限回退经 microtask 触发（setEditorState 须在 commit 落定后调用）
    await act(async () => {
      await Promise.resolve();
    });

    expect(editorText(editor).length).toBe(5000);
  });

  it('一次性写入 5001 字整体回退到上一个 editorState', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, 'ok');
    expect(editorText(editor)).toBe('ok');

    setEditorText(editor, 'x'.repeat(5001));

    // 超限回退经 microtask 触发（setEditorState 须在 commit 落定后调用）
    await act(async () => {
      await Promise.resolve();
    });

    expect(editorText(editor)).toBe('ok');
  });

  it('含 ImageNode 无文字时提交按钮可点', () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    const submit = screen.getByRole('button', { name: /拾光/ });
    expect(submit).toHaveProperty('disabled', true);

    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode().append($createImageNode({ src: 'blob:x' })));
        },
        { discrete: true },
      );
    });

    expect(submit).toHaveProperty('disabled', false);
  });

  it('提交调用 capture.create，busy 期间禁点防连点，成功后显示「✓ 已拾光」', async () => {
    let resolveCreate!: (value: unknown) => void;
    const api = createApiMock();
    api.capture.create = vi.fn(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        }),
    ) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, 'hello');
    const submit = screen.getByRole('button', { name: /拾光/ });
    fireEvent.click(submit);

    expect(api.capture.create).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', images: [] }),
    );
    expect(JSON.parse(vi.mocked(api.capture.create).mock.calls[0][0].document!)).toHaveProperty(
      'root',
    );

    // busy 态：提交按钮禁用，防连点
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.click(submit);
    expect(api.capture.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({
        id: 1,
        text: 'hello',
        imagePaths: [],
        sourceApp: null,
        createdAt: new Date().toISOString(),
      });
    });

    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();
  });

  it('成功后不收起窗口：闪现后清空编辑器回到可录态', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, 'hi');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    // 成功态反馈在按钮上，窗口不收起
    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();
    expect(window.api.input.close).not.toHaveBeenCalled();

    await vi.waitFor(
      () => {
        expect(editorText(editor)).toBe('');
      },
      { timeout: 3000, interval: 50 },
    );

    // 回到可录态：按钮恢复「拾光」，空内容时禁用，窗口全程未收起
    const submit = screen.getByRole('button', { name: '拾光' });
    expect(submit).toHaveProperty('disabled', true);
    expect(window.api.input.close).not.toHaveBeenCalled();
  });

  it('提交失败：按钮显示失败态，闪现后回到可录态且内容保留供重试', async () => {
    const api = createApiMock();
    api.capture.create = vi
      .fn()
      .mockRejectedValue(new Error('db busy')) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, 'keep me');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    expect(await screen.findByText('提交失败')).toBeTruthy();

    await vi.waitFor(
      () => {
        expect(screen.getByRole('button', { name: '拾光' })).toHaveProperty(
          'disabled',
          false,
        );
      },
      { timeout: 3000, interval: 50 },
    );

    // 失败回到可录态后内容保留，可直接重试；窗口不收起
    expect(editorText(editor)).toBe('keep me');
    expect(window.api.input.close).not.toHaveBeenCalled();
  });

  it('容器级 Esc 调用 input.close()', () => {
    window.api = createApiMock();
    render(<CaptureForm />);

    fireEvent.keyDown(editorElement(), { key: 'Escape' });
    expect(window.api.input.close).toHaveBeenCalledTimes(1);
  });
});

describe('CaptureForm 粘贴分流（任务 17：PASTE_COMMAND）', () => {
  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('粘贴 PNG 文件：光标处插入 ImageNode，字节经 objectURL Blob 落 imageBytesRef，无「暂不支持」提示', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, '前置文字');
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const urls: string[] = [];
    mockCreateObjectURL(urls);
    const { parts } = captureBlobParts();

    await act(async () => {
      dispatchPaste(editorElement(), makeClipboardData({ files: [makeImageFileStub(pngBytes)] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 文档出现 ImageNode，src 为 createObjectURL 返回值
    const imageNodes = editor.getEditorState().read(() => $nodesOfType(ImageNode));
    expect(imageNodes.length).toBe(1);
    expect(imageNodes[0].getSrc()).toBe('blob:mock-1');
    expect(urls).toEqual(['blob:mock-1']);
    // 字节经 Blob 进 objectURL（与存入 imageBytesRef 的字节同源，任务 18 消费）
    expect(parts.length).toBe(1);
    expect(parts[0][0]).toEqual(pngBytes);
    // 纯图片文件：无「暂不支持」提示；含图节点时按钮可点
    expect(screen.queryByText('暂不支持')).toBeNull();
    expect(screen.getByRole('button', { name: /拾光/ })).toHaveProperty('disabled', false);
  });

  it('粘贴纯非图片文件：提示「暂不支持」且不插入任何节点', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, '前置文字');
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });

    const urls: string[] = [];
    mockCreateObjectURL(urls);

    await act(async () => {
      dispatchPaste(
        editorElement(),
        makeClipboardData({ files: [new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' })] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText('暂不支持')).toBeTruthy();
    expect(editor.getEditorState().read(() => $nodesOfType(ImageNode).length)).toBe(0);
    expect(urls).toEqual([]);
    expect(editorText(editor)).toBe('前置文字');
  });

  it('混合剪贴板（text/plain + 图片文件）：文字进文字流且图片节点存在', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    setEditorText(editor, '前缀');
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });

    // Lexical 默认粘贴的 eventFiles 用 objectKlassEquals(event, ClipboardEvent)
    // 判定（按 constructor.name），jsdom 无 ClipboardEvent/DragEvent 全局，
    // stub 同名 class 使「文字交默认粘贴处理」路径可达
    class ClipboardEventShim extends Event {}
    Object.defineProperty(ClipboardEventShim, 'name', { value: 'ClipboardEvent' });
    vi.stubGlobal('ClipboardEvent', ClipboardEventShim);
    class DragEventShim extends Event {}
    Object.defineProperty(DragEventShim, 'name', { value: 'DragEvent' });
    vi.stubGlobal('DragEvent', DragEventShim);

    const pngBytes = new Uint8Array([1, 2, 3]);
    const urls: string[] = [];
    mockCreateObjectURL(urls);

    const event = new ClipboardEventShim('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: makeClipboardData({ files: [makeImageFileStub(pngBytes)], text: '混合文字' }),
    });

    await act(async () => {
      editorElement().dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(editorText(editor)).toContain('前缀');
    expect(editorText(editor)).toContain('混合文字');
    const imageNodes = editor.getEditorState().read(() => $nodesOfType(ImageNode));
    expect(imageNodes.length).toBe(1);
    expect(imageNodes[0].getSrc()).toBe('blob:mock-1');
    expect(screen.queryByText('暂不支持')).toBeNull();
  });
});

describe('CaptureForm 提交编排（任务 18：图文 payload 与清空/revoke）', () => {
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 经粘贴分流注入一张图片（字节落 imageBytesRef），返回其字节 */
  async function pasteImage(bytes: Uint8Array) {
    await act(async () => {
      dispatchPaste(
        editorElement(),
        makeClipboardData({ files: [makeImageFileStub(bytes)] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('图文混排提交：text 按段落分隔、document 为 EditorState JSON、images 字节顺序与文档序一致', async () => {
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    // 构造「文字 + 图A + 文字 + 图B」混排：图字节经粘贴分流入 ref
    setEditorText(editor, '上');
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });
    const urls: string[] = [];
    mockCreateObjectURL(urls);
    const pngA = new Uint8Array([1, 2, 3]);
    const pngB = new Uint8Array([4, 5, 6, 7]);
    await pasteImage(pngA);
    act(() => {
      editor.update(
        () => {
          $getRoot().append($createParagraphNode().append($createTextNode('下')));
        },
        { discrete: true },
      );
    });
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });
    await pasteImage(pngB);

    // 文档序确认：图A 独占段落夹在「上」「下」之间，图B 在「下」之后
    expect(editorText(editor)).toBe('上\n\n下');

    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    expect(window.api.capture.create).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(window.api.capture.create).mock.calls[0][0];
    // text 为 root 段落文本（\n 分隔），ImageNode 段落不贡献字符
    expect(payload.text).toBe('上\n\n下');
    // document 为完整 EditorState JSON（含图片节点，编辑功能预埋）
    const documentJson = JSON.parse(payload.document!);
    expect(documentJson.root.children.length).toBeGreaterThan(0);
    // images 字节顺序 = 文档顺序，data/sizeBytes 整包
    expect(payload.images).toEqual([
      { data: pngA, sizeBytes: pngA.length },
      { data: pngB, sizeBytes: pngB.length },
    ]);
  });

  it('成功后清空编辑器、revoke 全部 objectURL 并清空 imageBytesRef（再次提交不带旧图）', async () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
    window.api = createApiMock();
    const editorRef = renderInner();
    const editor = editorRef.current!;

    const urls: string[] = [];
    mockCreateObjectURL(urls);
    const pngA = new Uint8Array([9, 9]);
    // 先文字后贴图：setEditorText 会 root.clear()，须在其之前完成
    setEditorText(editor, 'hi');
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });
    await pasteImage(pngA);

    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));
    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();

    await vi.waitFor(
      () => {
        expect(editorText(editor)).toBe('');
      },
      { timeout: 3000, interval: 50 },
    );
    // revoke 该次提交携带的全部 objectURL
    expect(revoke).toHaveBeenCalledWith('blob:mock-1');

    // imageBytesRef 已清空：再粘贴新图提交，payload 只含新字节
    const pngB = new Uint8Array([7]);
    await pasteImage(pngB);
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));
    const lastPayload =
      vi.mocked(window.api.capture.create).mock.calls.at(-1)![0];
    expect(lastPayload.images).toEqual([{ data: pngB, sizeBytes: 1 }]);
  });

  it('提交失败：内容保留（含图片节点），payload 图文照常携带', async () => {
    const api = createApiMock();
    api.capture.create = vi
      .fn()
      .mockRejectedValue(new Error('disk full')) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInner();
    const editor = editorRef.current!;

    const urls: string[] = [];
    mockCreateObjectURL(urls);
    const pngA = new Uint8Array([5]);
    // 先文字后贴图：setEditorText 会 root.clear()，须在其之前完成
    setEditorText(editor, 'retry me');
    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
    });
    await pasteImage(pngA);

    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));
    expect(await screen.findByText('提交失败')).toBeTruthy();

    const payload = vi.mocked(api.capture.create).mock.calls[0][0];
    expect(payload.text).toBe('retry me');
    expect(payload.images).toEqual([{ data: pngA, sizeBytes: 1 }]);

    // 失败回到可录态后图文均保留，可直接重试
    await vi.waitFor(
      () => {
        expect(screen.getByRole('button', { name: '拾光' })).toHaveProperty(
          'disabled',
          false,
        );
      },
      { timeout: 3000, interval: 50 },
    );
    expect(editorText(editor)).toBe('retry me');
    expect(
      editor.getEditorState().read(() => $nodesOfType(ImageNode).length),
    ).toBe(1);
  });

  it('组件卸载时 revoke 编辑器内全部 objectURL', async () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
    window.api = createApiMock();
    const editorRef: { current: LexicalEditor | null } = { current: null };
    function EditorProbe() {
      const [editor] = useLexicalComposerContext();
      editorRef.current = editor;
      return null;
    }
    const { unmount } = render(
      <LexicalComposer initialConfig={initialConfig}>
        <CaptureFormInner />
        <EditorProbe />
      </LexicalComposer>,
    );
    const editor = editorRef.current!;

    const urls: string[] = [];
    mockCreateObjectURL(urls);
    await pasteImage(new Uint8Array([1]));
    expect(
      editor.getEditorState().read(() => $nodesOfType(ImageNode).length),
    ).toBe(1);

    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:mock-1');
  });
});

describe('CaptureForm 失败 toast 区分（任务 10：AI 无意义文案）', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** 表单外额外挂载 Toaster，使 toast() 推送可被断言 */
  function renderInnerWithToaster(): { current: LexicalEditor | null } {
    const editorRef = renderInner();
    render(<Toaster />);
    return editorRef;
  }

  it('提交中按钮显示「拾光中…」且禁用，resolve 后闪现「✓ 已拾光」且无 toast', async () => {
    let resolveCreate!: (value: unknown) => void;
    const api = createApiMock();
    api.capture.create = vi.fn(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        }),
    ) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInnerWithToaster();
    const editor = editorRef.current!;

    setEditorText(editor, 'hello');
    const submit = screen.getByRole('button', { name: /拾光/ });
    fireEvent.click(submit);

    // loading 终点 = 入库 + AI 分析完成（主进程串行编排），期间按钮禁用
    expect(submit.textContent).toBe('拾光中…');
    expect(submit).toHaveProperty('disabled', true);

    await act(async () => {
      resolveCreate({
        id: 1,
        text: 'hello',
        imagePaths: [],
        sourceApp: null,
        createdAt: new Date().toISOString(),
      });
    });

    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();
    // 成功路径不加 toast
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reject 且 err.message 为 AI_NOT_MEANINGFUL_MESSAGE：按钮闪现「提交失败」且 toast 固定文案', async () => {
    const api = createApiMock();
    api.capture.create = vi
      .fn()
      .mockRejectedValue(
        new Error(AI_NOT_MEANINGFUL_MESSAGE),
      ) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInnerWithToaster();
    const editor = editorRef.current!;

    setEditorText(editor, '乱敲内容');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    expect(await screen.findByText('提交失败')).toBeTruthy();
    expect(await screen.findByText(AI_NOT_MEANINGFUL_MESSAGE)).toBeTruthy();
  });

  it('reject 其他错误：toast 为「提交失败，请重试」', async () => {
    const api = createApiMock();
    api.capture.create = vi
      .fn()
      .mockRejectedValue(new Error('db busy')) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInnerWithToaster();
    const editor = editorRef.current!;

    setEditorText(editor, 'retry me');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    expect(await screen.findByText('提交失败')).toBeTruthy();
    expect(await screen.findByText('提交失败，请重试')).toBeTruthy();
  });
});

describe('CaptureForm 标签接入（任务 13：TagSelect + 记忆回填/lastSet）', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('标签栏独立于编辑器边框容器：独立元数据栏位于编辑器卡片上方', async () => {
    window.api = createApiMock();
    render(<CaptureForm />);

    const tagInput = screen.getByRole('textbox', { name: '标签' });
    // 向上找独立标签栏容器（rounded-md border + bg-neutral-50 元数据栏）
    let tagBar: HTMLElement | null = tagInput;
    while (tagBar && !tagBar.className.includes('bg-neutral-50')) {
      tagBar = tagBar.parentElement;
    }
    expect(tagBar).not.toBeNull();
    expect(tagBar!.className).toContain('rounded-md');
    const editor = editorElement();
    // 标签栏不包裹编辑器（TagSelect 已移出编辑器边框容器）
    expect(tagBar!.contains(editor)).toBe(false);
    // DOM 顺序：标签栏在编辑器卡片之前（自上而下：标签栏 → 编辑器卡片）
    expect(
      tagBar!.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('挂载后 tags.list 与 tags.lastGet 各调用一次，预选 chips 渲染（库外名称灰显 chip 仍在）', async () => {
    const api = createApiMock();
    api.tags.list = vi.fn().mockResolvedValue([
      { id: 1, name: '工作', color: '#f59e0b' },
    ]) as unknown as ShiguangApi['tags']['list'];
    api.tags.lastGet = vi
      .fn()
      .mockResolvedValue(['工作', '记忆X']) as unknown as ShiguangApi['tags']['lastGet'];
    window.api = api;
    renderInner();

    await vi.waitFor(() => {
      expect(api.tags.list).toHaveBeenCalledTimes(1);
      expect(api.tags.lastGet).toHaveBeenCalledTimes(1);
    });
    // 库内名称与库外记忆名称均渲染为 chips（库外灰显 #d4d4d4，chip 仍在）
    expect(await screen.findByText('工作')).toBeTruthy();
    expect(await screen.findByText('记忆X')).toBeTruthy();
    const chips = screen.getAllByRole('button', { name: /移除标签/ });
    expect(chips.length).toBe(2);
  });

  it('提交 invoke payload 含 tags 数组（与预选一致）与编辑器内容', async () => {
    const api = createApiMock();
    api.tags.lastGet = vi
      .fn()
      .mockResolvedValue(['预选']) as unknown as ShiguangApi['tags']['lastGet'];
    window.api = api;
    const editorRef = renderInner();
    const editor = editorRef.current!;

    await vi.waitFor(() => expect(api.tags.lastGet).toHaveBeenCalledTimes(1));
    setEditorText(editor, 'tagged');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    const payload = vi.mocked(api.capture.create).mock.calls[0][0];
    expect(payload.text).toBe('tagged');
    expect(payload.tags).toEqual(['预选']);
  });

  it('成功后 tags.lastSet 以同数组被调且 chips 仍保留（不清空预选）', async () => {
    const api = createApiMock();
    api.tags.lastGet = vi
      .fn()
      .mockResolvedValue(['预选']) as unknown as ShiguangApi['tags']['lastGet'];
    window.api = api;
    const editorRef = renderInner();
    const editor = editorRef.current!;

    await vi.waitFor(() => expect(api.tags.lastGet).toHaveBeenCalledTimes(1));
    setEditorText(editor, 'memo');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    expect(await screen.findByText('✓ 已拾光')).toBeTruthy();
    // lastSet 在成功闪现定时器内触发（600ms 后）
    await vi.waitFor(
      () => {
        expect(api.tags.lastSet).toHaveBeenCalledWith({ names: ['预选'] });
      },
      { timeout: 3000, interval: 50 },
    );
    // 成功路径不清空 selectedTags：chip 仍渲染
    expect(screen.getByText('预选')).toBeTruthy();

    await vi.waitFor(
      () => {
        expect(editorText(editor)).toBe('');
      },
      { timeout: 3000, interval: 50 },
    );
    // 编辑器已清空但 chips 依旧
    expect(screen.getByText('预选')).toBeTruthy();
  });

  it('tags.lastGet reject（降级）→ 组件正常渲染无预选 chips', async () => {
    const api = createApiMock();
    api.tags.lastGet = vi
      .fn()
      .mockRejectedValue(new Error('io error')) as unknown as ShiguangApi['tags']['lastGet'];
    window.api = api;
    renderInner();

    // 记忆读取失败不影响表单主体可用
    await vi.waitFor(() => expect(api.tags.lastGet).toHaveBeenCalledTimes(1));
    expect(editorElement().getAttribute('contenteditable')).toBe('true');
    expect(screen.queryByRole('button', { name: /移除标签/ })).toBeNull();
  });

  it('capture.create reject → chips 与 tagLib 保留（失败路径标签状态不动）', async () => {
    const api = createApiMock();
    api.tags.list = vi.fn().mockResolvedValue([
      { id: 1, name: '工作', color: '#f59e0b' },
    ]) as unknown as ShiguangApi['tags']['list'];
    api.tags.lastGet = vi
      .fn()
      .mockResolvedValue(['工作']) as unknown as ShiguangApi['tags']['lastGet'];
    api.capture.create = vi
      .fn()
      .mockRejectedValue(new Error('db busy')) as unknown as ShiguangApi['capture']['create'];
    window.api = api;
    const editorRef = renderInner();
    const editor = editorRef.current!;

    await vi.waitFor(() => expect(api.tags.lastGet).toHaveBeenCalledTimes(1));
    setEditorText(editor, 'retry tag');
    fireEvent.click(screen.getByRole('button', { name: /拾光/ }));

    expect(await screen.findByText('提交失败')).toBeTruthy();
    // 失败路径：预选 chips 与标签库结果均保留（未触发 lastSet 记忆）
    expect(screen.getByText('工作')).toBeTruthy();
    expect(api.tags.lastSet).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createEditor, ParagraphNode, TextNode, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { ImageNode, $createImageNode } from '../input/features/capture/image-node';
import { RichCapturePreview } from './rich-capture-preview';

/**
 * 用 headless 编辑器（createEditor + disableEvents，即官方 createHeadlessEditor 的本质）
 * 构造真实 EditorState 再 toJSON()，保证 fixture 一定合法
 * （手写 JSON 对 parseEditorState 的容忍度不作假设）。
 */
function makeDocument(build: () => void): string {
  const editor = createEditor({
    namespace: 'shiguang-test',
    nodes: [ParagraphNode, TextNode, ImageNode],
    onError: () => {},
    disableEvents: true,
  });
  // discrete: headless 编辑器无事件循环驱动，update 需同步离散提交
  editor.update(build, { discrete: true });
  return JSON.stringify(editor.getEditorState().toJSON());
}

/** 段落 + 独占图片段落 + 段落 */
function makeMixedDocument(): string {
  return makeDocument(() => {
    const root = $getRoot();
    root.append($createParagraphNode().append($createTextNode('第一段')));
    root.append($createParagraphNode().append($createImageNode({ src: 'images/abc-uuid.png' })));
    root.append($createParagraphNode().append($createTextNode('结尾段')));
  });
}

function makeTextDocument(): string {
  return makeDocument(() => {
    const root = $getRoot();
    root.append($createParagraphNode().append($createTextNode('纯文字一')));
    root.append($createParagraphNode().append($createTextNode('纯文字二')));
  });
}

/** 本次 bug 回归锁：单段落内文字 + 图片行内混排 */
function makeInlineMixedDocument(): string {
  return makeDocument(() => {
    const root = $getRoot();
    root.append(
      $createParagraphNode().append($createTextNode('12312'), $createImageNode({ src: 'images/inline.png' })),
    );
  });
}

describe('RichCapturePreview 混排预览', () => {
  afterEach(cleanup);

  it('段落+图片+段落按序渲染，图片 src 为协议 URL（basename）', () => {
    const { container } = render(
      <RichCapturePreview document={makeMixedDocument()} text="兜底" expanded={false} />,
    );
    const ps = container.querySelectorAll('p');
    // 官方序列化下图片段落导出为 <p><img></p>（图片不再脱离段落裸渲染）
    expect(ps).toHaveLength(3);
    expect(ps[0].textContent).toBe('第一段');
    expect(ps[1].textContent).toBe('');
    expect(ps[2].textContent).toBe('结尾段');
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('shiguang-image://abc-uuid.png');
    // 图片位于两段之间
    expect(ps[0].compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ps[2].compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('纯文字 document 自然渲染为若干段落', () => {
    render(
      <RichCapturePreview document={makeTextDocument()} text="兜底" expanded={false} />,
    );
    expect(screen.getByText('纯文字一')).toBeTruthy();
    expect(screen.getByText('纯文字二')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('document 为 null 时回退渲染 text 兜底段落', () => {
    render(<RichCapturePreview document={null} text="兜底文字" expanded={false} />);
    const p = screen.getByText('兜底文字');
    expect(p.tagName).toBe('P');
    expect(p.className).toContain('text-sm');
  });

  it('document 为损坏 JSON 时回退渲染 text 兜底段落', () => {
    render(<RichCapturePreview document="{not-json" text="兜底文字" expanded={false} />);
    expect(screen.getByText('兜底文字')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('document 结构非法（root 为空）时回退渲染 text', () => {
    render(
      <RichCapturePreview document='{"root":{}}' text="兜底文字" expanded={false} />,
    );
    expect(screen.getByText('兜底文字')).toBeTruthy();
  });

  it('收起态内容容器限高 max-h-40 且有底部渐变遮罩，展开态不设限高', () => {
    const { container, unmount } = render(
      <RichCapturePreview document={makeTextDocument()} text="兜底" expanded={false} />,
    );
    expect(container.querySelector('.max-h-40')).toBeTruthy();
    expect(container.querySelector('.overflow-hidden')).toBeTruthy();
    const overlay = container.querySelector('.bg-gradient-to-t');
    expect(overlay).toBeTruthy();
    expect((overlay as HTMLElement).className).toContain('h-8');

    unmount();
    const { container: expanded } = render(
      <RichCapturePreview document={makeTextDocument()} text="兜底" expanded />,
    );
    expect(expanded.querySelector('.max-h-40')).toBeNull();
    expect(expanded.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('图文同段落：文字与图片都渲染，文字在图片前（丢字 bug 回归）', () => {
    const { container } = render(
      <RichCapturePreview document={makeInlineMixedDocument()} text="兜底" expanded={false} />,
    );
    expect(screen.getByText('12312')).toBeTruthy();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('shiguang-image://inline.png');
    const textNode = screen.getByText('12312');
    expect(
      textNode.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('富文本 format 生效：加粗 → <strong>，斜体 → <em>', () => {
    const { container } = render(
      <RichCapturePreview
        document={makeDocument(() => {
          const root = $getRoot();
          root.append(
            $createParagraphNode().append(
              $createTextNode('粗体').setFormat('bold'),
              $createTextNode('斜体').setFormat('italic'),
            ),
          );
        })}
        text="兜底"
        expanded={false}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('粗体');
    expect(container.querySelector('em')?.textContent).toBe('斜体');
  });
});

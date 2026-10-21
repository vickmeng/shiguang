/**
 * image-node.ts — Lexical 图片装饰节点（拾光输入框）
 *
 * 行为契约：
 * - 照 Lexical 官方 playground ImageNode 精简为 DecoratorNode，仅承载图片地址；
 * - decorate 渲染行内 <img src={...}>；粘贴字节由 capture-form 的 imageBytesRef
 *   以节点 key 关联管理（本节点不持有字节）；
 * - importJSON / exportJSON 仅读写 { src }，序列化形状由 SerializedImageNode 校验。
 */
import type { JSX } from 'react';
import { createElement } from 'react';
import type { NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { DecoratorNode, LexicalNode } from 'lexical';

export type SerializedImageNode = Spread<{ src: string }, SerializedLexicalNode>;

export type ImageNodeProps = { src: string };

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__key);
  }

  constructor(src: string, key?: NodeKey) {
    super(key);
    this.__src = src;
  }

  createDOM(): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    // max-w-full 约束：粘贴的截图可能是远超容器宽的原尺寸图，不约束会横向撑破编辑器
    return createElement('img', { src: this.__src, className: 'max-w-full' });
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({ src: serializedNode.src });
  }

  exportJSON(): SerializedImageNode {
    return { ...super.exportJSON(), src: this.__src };
  }

  getSrc(): string {
    return this.__src;
  }
}

export function $createImageNode({ src }: ImageNodeProps): ImageNode {
  return new ImageNode(src);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

export function isImageNode(node: unknown): node is ImageNode {
  return node instanceof ImageNode;
}

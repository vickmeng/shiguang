/**
 * tagMemoryStore：标签组合记忆（REQ-TAG-02 / AC-3）。
 *
 * 将「本次提交的标签名组合」持久化到 userData/tags-last.json，
 * 与库内 tags 条目解耦（仅存名称快照）。读取对文件缺失/损坏/非数组
 * 一律降级 []，保证预选记忆故障不影响输入框正常使用；
 * 写入先写 .tmp 再 rename，原子替换避免半写 JSON。
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const LAST_TAGS_FILE = 'tags-last.json';

/** 读取上次提交的标签名组合；文件缺失/损坏/非数组降级 []。 */
export function getLastTags(): string[] {
  try {
    const raw = readFileSync(path.join(app.getPath('userData'), LAST_TAGS_FILE), 'utf-8');
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 记忆本次提交的标签组合（原子写：.tmp + rename）。 */
export function setLastTags(names: string[]): void {
  const target = path.join(app.getPath('userData'), LAST_TAGS_FILE);
  writeFileSync(target + '.tmp', JSON.stringify(names));
  renameSync(target + '.tmp', target);
}

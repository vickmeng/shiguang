import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileDocument } from '@shiguang/shared';
import { initDatabase } from '../db';
import {
  getProfile,
  pendingCount,
  pendingSummaries,
  recentMentions,
  saveProfileWithStamp,
  setProfileDatabase,
} from './profileDao';

/** 造一条 records + analyses 行，返回 record_id */
function seedRecord(
  db: Database.Database,
  input: {
    text: string;
    tags?: string;
    summary?: string;
    grade?: string | null;
    createdAt?: string;
    profiledAt?: string | null;
  },
): number {
  const recordId = Number(
    (
      db
        .prepare(
          `INSERT INTO records (text, tags, created_at) VALUES (?, ?, ?)`,
        )
        .run(
          input.text,
          input.tags ?? '[]',
          input.createdAt ??
            (
              db
                .prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`)
                .get() as { now: string }
            ).now,
        ) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.prepare(`INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, ?, ?)`).run(
    recordId,
    input.summary ?? `摘要-${input.text}`,
    'kimi-k2.6',
    input.grade ?? null,
  );
  if (input.profiledAt !== undefined) {
    db.prepare(`UPDATE analyses SET profiled_at = ? WHERE record_id = ?`).run(
      input.profiledAt,
      recordId,
    );
  }
  return recordId;
}

describe('profileDao', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-profile-dao-test-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    setProfileDatabase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getProfile 在空表返回 null', () => {
    expect(getProfile()).toBeNull();
  });

  it('saveProfileWithStamp 后 getProfile 读回 document 深相等与 updated_at', () => {
    const document: ProfileDocument = {
      identity: ['程序员'],
      recent: ['在学 Rust'],
      interests: ['徒步'],
      values: ['看重家庭'],
      goals: ['成为独立开发者'],
      misc: ['养了一只猫'],
    };

    saveProfileWithStamp({ document, stampedIds: [] });

    const row = getProfile();
    expect(row).not.toBeNull();
    expect(row!.document).toEqual(document);
    expect(row!.updatedAt).toBeTruthy();
    // updated_at 为合法 ISO 字符串
    expect(new Date(row!.updatedAt).toString()).not.toBe('Invalid Date');
  });

  it('重复 save 为 UPSERT：profiles 仅一行且 document 被覆盖', () => {
    const first: ProfileDocument = {
      identity: ['第一版'],
      recent: [],
      interests: [],
      values: [],
      goals: [],
      misc: [],
    };
    const second: ProfileDocument = {
      identity: ['第二版'],
      recent: ['新话题'],
      interests: [],
      values: [],
      goals: [],
      misc: [],
    };

    saveProfileWithStamp({ document: first, stampedIds: [] });
    saveProfileWithStamp({ document: second, stampedIds: [] });

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM profiles`).get() as { n: number }
    ).n;
    expect(count).toBe(1);
    expect(getProfile()!.document).toEqual(second);
  });

  it('stampedIds 命中的 analyses 行 profiled_at 置为画像同一时刻，未命中行保持 NULL', () => {
    const hitId = seedRecord(db, { text: '命中' });
    const missId = seedRecord(db, { text: '未命中' });
    // 一条不带 analyses 行的记录（凑 stampedIds 含不存在 id 时不抛错）
    db.prepare(`INSERT INTO records (text) VALUES ('无摘要')`).run();
    const orphanId = hitId + missId + 999;

    const document: ProfileDocument = {
      identity: [],
      recent: [],
      interests: [],
      values: [],
      goals: [],
      misc: [],
    };
    saveProfileWithStamp({ document, stampedIds: [hitId, orphanId] });

    const updatedAt = getProfile()!.updatedAt;
    const hitRow = db
      .prepare(`SELECT profiled_at FROM analyses WHERE record_id = ?`)
      .get(hitId) as { profiled_at: string | null };
    const missRow = db
      .prepare(`SELECT profiled_at FROM analyses WHERE record_id = ?`)
      .get(missId) as { profiled_at: string | null };
    expect(hitRow.profiled_at).toBe(updatedAt);
    expect(missRow.profiled_at).toBeNull();
  });

  it('document 字段写入坏 JSON 时 getProfile 返回 null 不抛', () => {
    db.prepare(`INSERT INTO profiles (id, document, updated_at) VALUES (1, ?, ?)`).run(
      '{broken json',
      '2026-10-27T00:00:00.000Z',
    );

    expect(getProfile()).toBeNull();
  });

  it('stampedIds 为空数组时不执行 analyses 打戳（全为 NULL）', () => {
    const id = seedRecord(db, { text: '不带戳' });

    saveProfileWithStamp({
      document: { identity: [], recent: [], interests: [], values: [], goals: [], misc: [] },
      stampedIds: [],
    });

    const row = db
      .prepare(`SELECT profiled_at FROM analyses WHERE record_id = ?`)
      .get(id) as { profiled_at: string | null };
    expect(row.profiled_at).toBeNull();
  });
});

describe('profileDao 待汇总队列', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-profile-dao-queue-test-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    setProfileDatabase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('pendingSummaries 仅返回未打戳行，按 created_at 升序（同刻按 record_id 升序），tags 解析、grade 透出', () => {
    const stampedId = seedRecord(db, {
      text: '已汇总',
      createdAt: '2026-10-20T01:00:00.000Z',
      profiledAt: '2026-10-21T00:00:00.000Z',
    });
    // 同刻两条：record_id 升序兜底
    const laterA = seedRecord(db, {
      text: '晚-A',
      tags: '["工作","rust"]',
      summary: '摘要-晚-A',
      grade: 'high',
      createdAt: '2026-10-22T02:00:00.000Z',
    });
    const laterB = seedRecord(db, {
      text: '晚-B',
      tags: '["生活"]',
      summary: '摘要-晚-B',
      grade: null,
      createdAt: '2026-10-22T02:00:00.000Z',
    });
    const earlier = seedRecord(db, {
      text: '早',
      tags: '[]',
      summary: '摘要-早',
      grade: 'medium',
      createdAt: '2026-10-21T08:00:00.000Z',
    });

    const list = pendingSummaries();

    expect(list.map((s) => s.recordId)).toEqual([earlier, laterA, laterB]);
    expect(list).not.toContainEqual(expect.objectContaining({ recordId: stampedId }));

    const [first, second, third] = list;
    expect(first).toEqual({
      recordId: earlier,
      summary: '摘要-早',
      grade: 'medium',
      tags: [],
      createdAt: '2026-10-21T08:00:00.000Z',
    });
    expect(second.tags).toEqual(['工作', 'rust']);
    expect(second.grade).toBe('high');
    expect(third.tags).toEqual(['生活']);
    expect(third.grade).toBeNull();
  });

  it('records.tags 为坏 JSON 时该条 tags 为 [] 不抛', () => {
    seedRecord(db, { text: '坏标签', tags: '{broken', createdAt: '2026-10-21T00:00:00.000Z' });

    const list = pendingSummaries();

    expect(list).toHaveLength(1);
    expect(list[0].tags).toEqual([]);
  });

  it('pendingCount 为未打戳条数，全部打戳后为 0', () => {
    seedRecord(db, { text: '一', createdAt: '2026-10-20T01:00:00.000Z' });
    seedRecord(db, { text: '二', createdAt: '2026-10-20T02:00:00.000Z' });
    seedRecord(db, {
      text: '三',
      createdAt: '2026-10-20T03:00:00.000Z',
      profiledAt: '2026-10-21T00:00:00.000Z',
    });

    expect(pendingCount()).toBe(2);

    saveProfileWithStamp({
      document: { identity: [], recent: [], interests: [], values: [], goals: [], misc: [] },
      stampedIds: pendingSummaries().map((s) => s.recordId),
    });

    expect(pendingCount()).toBe(0);
    expect(pendingSummaries()).toEqual([]);
  });
});

describe('profileDao 近期记录概览', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T00:00:00.000Z'));
    tmpDir = mkdtempSync(join(tmpdir(), 'shiguang-profile-dao-recent-test-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    setProfileDatabase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  /** 相对当前（fake 时间 2026-10-28T00:00:00Z）往前 N 天的 ISO 字符串 */
  function isoDaysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it('普通窗口内记录返回，analyzed 标记正确，按 created_at 倒序', () => {
    const analyzedId = seedRecord(db, {
      text: '窗口内-已分析',
      tags: '["工作","AI"]',
      grade: 'high',
      createdAt: isoDaysAgo(3),
      profiledAt: '2026-10-27T00:00:00.000Z',
    });
    const freshId = seedRecord(db, {
      text: '窗口内-未分析',
      tags: '[]',
      grade: null,
      createdAt: isoDaysAgo(1),
    });

    const list = recentMentions();

    expect(list.map((m) => m.recordId)).toEqual([freshId, analyzedId]);
    expect(list[0]).toEqual({
      recordId: freshId,
      createdAt: isoDaysAgo(1),
      grade: null,
      tags: [],
      analyzed: false,
      summary: '摘要-窗口内-未分析',
    });
    expect(list[1]).toMatchObject({
      recordId: analyzedId,
      grade: 'high',
      tags: ['工作', 'AI'],
      analyzed: true,
      summary: '摘要-窗口内-已分析',
    });
  });

  it('30 天窗口外的普通记录（grade 非 high）排除', () => {
    seedRecord(db, { text: '窗口外-普通', grade: 'low', createdAt: isoDaysAgo(40) });

    expect(recentMentions()).toEqual([]);
  });

  it('90 天窗口内（30 天外）的 grade=high 记录仍返回；超过 90 天的 high 记录排除', () => {
    const high40 = seedRecord(db, { text: '40天前-high', grade: 'high', createdAt: isoDaysAgo(40) });
    seedRecord(db, { text: '100天前-high', grade: 'high', createdAt: isoDaysAgo(100) });

    const list = recentMentions();

    expect(list.map((m) => m.recordId)).toEqual([high40]);
  });

  it('超过 RECENT_LIMIT=100 条时按 created_at 倒序截断为 100 条', () => {
    for (let i = 0; i < 120; i += 1) {
      // 均匀铺在 30 天窗口内（i 越小越新）
      seedRecord(db, {
        text: `第${i}条`,
        createdAt: new Date(Date.now() - i * 6 * 60 * 60 * 1000).toISOString(),
      });
    }

    const list = recentMentions();

    expect(list).toHaveLength(100);
    for (let i = 0; i < list.length - 1; i += 1) {
      expect(list[i].createdAt >= list[i + 1].createdAt).toBe(true);
    }
  });

  it('records.tags 为坏 JSON 时该条 tags 为 [] 不抛', () => {
    seedRecord(db, { text: '坏标签', tags: '{broken', createdAt: isoDaysAgo(1) });

    const list = recentMentions();

    expect(list).toHaveLength(1);
    expect(list[0].tags).toEqual([]);
  });
});

describe('profileDao 未初始化', () => {
  it('未注入数据库时 getProfile / saveProfileWithStamp 抛初始化指引错误', async () => {
    vi.resetModules();
    const fresh = await import('./profileDao');

    expect(() => fresh.getProfile()).toThrow(/profileDao: database not initialized/);
    expect(() => fresh.pendingSummaries()).toThrow(/profileDao: database not initialized/);
    expect(() => fresh.recentMentions()).toThrow(/profileDao: database not initialized/);
    expect(() => fresh.pendingCount()).toThrow(/profileDao: database not initialized/);
    expect(() =>
      fresh.saveProfileWithStamp({
        document: { identity: [], recent: [], interests: [], values: [], goals: [], misc: [] },
        stampedIds: [],
      }),
    ).toThrow(/profileDao: database not initialized/);

    // 还原模块状态，避免影响其他文件的测试进程内缓存（vitest 每文件独立 worker，此处仅为稳妥）
    vi.resetModules();
  });
});

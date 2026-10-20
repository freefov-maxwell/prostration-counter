import { describe, expect, it } from 'vitest';
import { computeStreak, dailyBuckets, computeTotals } from './stats';
import { Session } from './db';

function sessionAt(ts: number, count = 1): Session {
  return { startedAt: ts, endedAt: ts + 60000, count, manualAdjust: 0, durationSec: 60 };
}

// 固定"现在"：2026-10-20 12:00 本地时间
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();
function daysAgo(n: number, hour = 10): number {
  const d = new Date(2026, 9, 20, hour, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

describe('streak 连续天数', () => {
  it('无记录 → 0', () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it('今天有记录 → 至少 1', () => {
    expect(computeStreak([sessionAt(daysAgo(0))], NOW)).toBe(1);
  });

  it('今天 + 昨天 + 前天 → 3', () => {
    const s = [sessionAt(daysAgo(0)), sessionAt(daysAgo(1)), sessionAt(daysAgo(2))];
    expect(computeStreak(s, NOW)).toBe(3);
  });

  it('今天没练但昨天练了：不断签，从昨天算起', () => {
    const s = [sessionAt(daysAgo(1)), sessionAt(daysAgo(2))];
    expect(computeStreak(s, NOW)).toBe(2);
  });

  it('断签：今天和三天前有、昨天没有 → 1', () => {
    const s = [sessionAt(daysAgo(0)), sessionAt(daysAgo(3))];
    expect(computeStreak(s, NOW)).toBe(1);
  });

  it('只有三天前的记录 → 0', () => {
    expect(computeStreak([sessionAt(daysAgo(3))], NOW)).toBe(0);
  });

  it('同一天多条记录只算一天', () => {
    const s = [sessionAt(daysAgo(0, 8)), sessionAt(daysAgo(0, 20)), sessionAt(daysAgo(1))];
    expect(computeStreak(s, NOW)).toBe(2);
  });
});

describe('dailyBuckets / totals', () => {
  it('近 7 天柱状图含 0 天且计数正确', () => {
    const s = [sessionAt(daysAgo(0), 108), sessionAt(daysAgo(0), 20), sessionAt(daysAgo(3), 50)];
    const buckets = dailyBuckets(s, 7, NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets[6].count).toBe(128);
    expect(buckets[3].count).toBe(50);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(178);
  });

  it('totals 聚合', () => {
    const s = [sessionAt(daysAgo(0), 108), sessionAt(daysAgo(1), 54)];
    const t = computeTotals(s);
    expect(t.totalCount).toBe(162);
    expect(t.totalDurationSec).toBe(120);
    expect(t.totalDays).toBe(2);
  });
});

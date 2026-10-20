// 统计聚合：纯函数，输入会话列表，便于单测。streak 读取时计算，不冗余存储。
import { Session } from './db';

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function shiftDay(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 当前连续练习天数。今天没练但昨天练了，streak 从昨天算起不断签。 */
export function computeStreak(sessions: Session[], now = Date.now()): number {
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  if (days.size === 0) return 0;
  let cursor = now;
  if (!days.has(dayKey(cursor))) {
    const yesterday = shiftDay(cursor, -1);
    if (!days.has(dayKey(yesterday))) return 0;
    cursor = yesterday;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

/** 近 N 天每日次数（含无记录的 0 天），按时间升序。 */
export function dailyBuckets(sessions: Session[], days: number, now = Date.now()): { label: string; count: number }[] {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    byDay.set(k, (byDay.get(k) ?? 0) + s.count);
  }
  const out: { label: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = shiftDay(now, -i);
    const d = new Date(ts);
    out.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: byDay.get(dayKey(ts)) ?? 0,
    });
  }
  return out;
}

export interface Totals {
  totalCount: number;
  totalDurationSec: number;
  totalDays: number;
}

export function computeTotals(sessions: Session[]): Totals {
  return {
    totalCount: sessions.reduce((s, x) => s + x.count, 0),
    totalDurationSec: sessions.reduce((s, x) => s + x.durationSec, 0),
    totalDays: new Set(sessions.map((s) => dayKey(s.startedAt))).size,
  };
}

export function todayCount(sessions: Session[], now = Date.now()): number {
  const k = dayKey(now);
  return sessions.filter((s) => dayKey(s.startedAt) === k).reduce((sum, s) => sum + s.count, 0);
}

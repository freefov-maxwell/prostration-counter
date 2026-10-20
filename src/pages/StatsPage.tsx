import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeStreak, computeTotals, dailyBuckets } from '../db/stats';

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function BarChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const w = 100 / data.length;
  return (
    <svg viewBox="0 0 100 32" className="bar-chart" preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.count / max) * 28;
        return (
          <rect
            key={i}
            x={i * w + w * 0.2}
            y={30 - h}
            width={w * 0.6}
            height={h}
            className="bar"
          >
            <title>{`${d.label}: ${d.count}`}</title>
          </rect>
        );
      })}
      <line x1="0" y1="30" x2="100" y2="30" className="axis" />
    </svg>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StatsPage() {
  const { sessions, navigate, deleteSession } = useAppStore();
  const [days, setDays] = useState<7 | 30>(7);
  const totals = computeTotals(sessions);
  const streak = computeStreak(sessions);
  const buckets = dailyBuckets(sessions, days);

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-text" onClick={() => navigate('home')}>
          ‹ 返回
        </button>
        <h2>统计</h2>
        <span />
      </header>

      <div className="summary-grid">
        <div className="stat-card">
          <div className="stat-value">{totals.totalCount}</div>
          <div className="stat-label">累计次数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtDuration(totals.totalDurationSec)}</div>
          <div className="stat-label">累计时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totals.totalDays}</div>
          <div className="stat-label">练习天数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">连续天数</div>
        </div>
      </div>

      <section className="section">
        <div className="option-row">
          <button className={days === 7 ? 'chip chip-active' : 'chip'} onClick={() => setDays(7)}>
            近 7 天
          </button>
          <button className={days === 30 ? 'chip chip-active' : 'chip'} onClick={() => setDays(30)}>
            近 30 天
          </button>
        </div>
        <BarChart data={buckets} />
      </section>

      <section className="section">
        <h3>历史记录</h3>
        {sessions.length === 0 && <p className="hint">还没有记录，开始第一次大礼拜吧。</p>}
        <ul className="history-list">
          {sessions.map((s) => (
            <li key={s.id} className="history-item">
              <span>{fmtTime(s.startedAt)}</span>
              <span>{s.count} 拜</span>
              <span>{fmtDuration(s.durationSec)}</span>
              <button
                className="btn-text danger"
                onClick={() => {
                  if (window.confirm('删除这条记录？')) void deleteSession(s.id!);
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

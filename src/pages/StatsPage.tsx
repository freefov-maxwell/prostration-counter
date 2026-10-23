import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeStreak, computeTotals, dailyBuckets, todayCount } from '../db/stats';
import { Session } from '../db/db';

const HEAT_DAYS = 84; // 12 周
const HISTORY_PAGE = 7; // 历史记录每次多显示的天数

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function BarChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const active = data.filter((d) => d.count > 0);
  const avg = active.length ? active.reduce((s, d) => s + d.count, 0) / active.length : 0;
  const dense = data.length > 10;
  return (
    <div className={dense ? 'bars dense' : 'bars'}>
      {avg > 0 && (
        <div className="bars-avg" style={{ bottom: `calc(20px + (100% - 38px) * ${avg / max})` }} />
      )}
      {data.map((d, i) => {
        const isToday = i === data.length - 1;
        const showLabel = !dense || (data.length - 1 - i) % 7 === 0;
        return (
          <div key={i} className="bar-col" title={`${d.label}：${d.count} 次`}>
            <div className="bar-track">
              {!dense && d.count > 0 && <span className="bar-value">{d.count}</span>}
              <div
                className={isToday ? 'bar-fill today' : 'bar-fill'}
                style={{ height: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="bar-label">{showLabel ? (isToday ? (dense ? '今' : '今天') : d.label) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function Heatmap({ data, now }: { data: { label: string; count: number }[]; now: number }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const first = new Date(now);
  first.setDate(first.getDate() - (data.length - 1));
  const lead = (first.getDay() + 6) % 7; // 每列从周一开始
  const level = (c: number) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`p${i}`} className="heat-cell empty" />
        ))}
        {data.map((d, i) => (
          <span key={i} className={`heat-cell l${level(d.count)}`} title={`${d.label}：${d.count} 次`} />
        ))}
      </div>
      <div className="heat-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-cell l${l}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEK = '日一二三四五六';

/** 按自然日分组，保持 sessions 原有顺序。 */
function groupByDay(sessions: Session[]) {
  const groups: { key: string; title: string; total: number; items: Session[] }[] = [];
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    const key = d.toDateString();
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, title: `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEK[d.getDay()]}`, total: 0, items: [] };
      groups.push(g);
    }
    g.total += s.count;
    g.items.push(s);
  }
  return groups;
}

export function StatsPage() {
  const { sessions, navigate, deleteSession } = useAppStore();
  const [days, setDays] = useState<7 | 30>(7);
  const [historyDays, setHistoryDays] = useState(HISTORY_PAGE);
  const now = Date.now();
  const totals = computeTotals(sessions);
  const streak = computeStreak(sessions, now);
  const today = todayCount(sessions, now);
  const buckets = dailyBuckets(sessions, days, now);
  const heat = dailyBuckets(sessions, HEAT_DAYS, now);
  const periodTotal = buckets.reduce((s, d) => s + d.count, 0);
  const periodDays = buckets.filter((d) => d.count > 0).length;
  const periodAvg = periodDays ? Math.round(periodTotal / periodDays) : 0;
  const groups = groupByDay(sessions);
  const bestSession = sessions.reduce((m, s) => Math.max(m, s.count), 0);
  const bestDay = heat.reduce((m, d) => Math.max(m, d.count), 0);
  const perSession = sessions.length ? Math.round(totals.totalCount / sessions.length) : 0;

  return (
    <div className="page stats-page">
      <header className="page-header">
        <button className="btn-text" onClick={() => navigate('home')}>
          ‹ 返回
        </button>
        <h2>统计</h2>
        <span />
      </header>

      <div className="stats-hero">
        <div className="hero-seal">
          <span className="hero-num">{streak}</span>
          <span className="hero-unit">天</span>
        </div>
        <div>
          <div className="hero-title">{streak > 0 ? '连续精进' : '今日起步'}</div>
          <div className="hero-sub">
            {today > 0 ? `今日已拜 ${today} 次` : streak > 0 ? '今天还没练，别断了' : '开始第一拜，积日成功'}
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <div className="stat-card">
          <div className="stat-value">{totals.totalCount}</div>
          <div className="stat-label">累计次数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{fmtDuration(totals.totalDurationSec)}</div>
          <div className="stat-label">累计时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totals.totalDays}</div>
          <div className="stat-label">练习天数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{sessions.length}</div>
          <div className="stat-label">练习场次</div>
        </div>
      </div>

      <section className="stats-panel">
        <div className="panel-head">
          <h3>每日次数</h3>
          <div className="seg">
            <button className={days === 7 ? 'seg-on' : ''} onClick={() => setDays(7)}>
              7 天
            </button>
            <button className={days === 30 ? 'seg-on' : ''} onClick={() => setDays(30)}>
              30 天
            </button>
          </div>
        </div>
        <div className="period-line">
          共 <b>{periodTotal}</b> 次 · 练习 <b>{periodDays}</b> / {days} 天
          {periodAvg > 0 && (
            <span className="avg-key">
              日均 <b>{periodAvg}</b>
            </span>
          )}
        </div>
        <BarChart data={buckets} />
      </section>

      <section className="stats-panel">
        <div className="panel-head">
          <h3>近 12 周</h3>
        </div>
        <Heatmap data={heat} now={now} />
      </section>

      <div className="bests">
        <div>
          <span className="best-value">{bestSession}</span>
          <span className="best-label">单场最多</span>
        </div>
        <div>
          <span className="best-value">{bestDay}</span>
          <span className="best-label">单日最多</span>
        </div>
        <div>
          <span className="best-value">{perSession}</span>
          <span className="best-label">场均次数</span>
        </div>
      </div>

      <section className="section">
        <h3>历史记录</h3>
        {sessions.length === 0 && <p className="hint">还没有记录，开始第一次归元瑜伽吧。</p>}
        {groups.slice(0, historyDays).map((g) => (
          <div key={g.key} className="history-group">
            <div className="history-day">
              <span>{g.title}</span>
              <span>{g.total} 次</span>
            </div>
            <ul className="history-list">
              {g.items.map((s) => {
                const d = new Date(s.startedAt);
                const met = s.target != null && s.count >= s.target;
                return (
                  <li key={s.id} className="history-item">
                    <span className="h-time">{`${pad(d.getHours())}:${pad(d.getMinutes())}`}</span>
                    <span className="h-count">
                      {s.count}
                      <small> 次</small>
                      {s.target != null && (
                        <span className={met ? 'h-badge met' : 'h-badge'}>{met ? '达标' : `目标 ${s.target}`}</span>
                      )}
                    </span>
                    <span className="h-dur">{fmtDuration(s.durationSec)}</span>
                    <button
                      className="btn-text danger"
                      onClick={() => {
                        if (window.confirm('删除这条记录？')) void deleteSession(s.id!);
                      }}
                    >
                      删除
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {groups.length > historyDays && (
          <button className="btn-secondary more-btn" onClick={() => setHistoryDays((n) => n + HISTORY_PAGE)}>
            显示更早记录（还有 {groups.length - historyDays} 天）
          </button>
        )}
      </section>
    </div>
  );
}

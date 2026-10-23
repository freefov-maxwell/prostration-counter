import { useAppStore } from '../store/useAppStore';
import { scripture } from '../scripture';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function SummaryPage() {
  const { lastSummary, charIndex, settings, navigate } = useAppStore();
  if (!lastSummary) {
    navigate('home');
    return null;
  }
  const { count, durationSec, avgPaceSec, target } = lastSummary;
  const pct = ((charIndex / scripture.totalChars) * 100).toFixed(1);

  return (
    <div className="page">
      <header className="page-header">
        <span />
        <h2>本次完成</h2>
        <span />
      </header>

      <div className="big-count summary-count">{count}</div>
      {target != null && (
        <p className="hint center">
          目标 {target} 次{count >= target ? '，已达成' : ''}
        </p>
      )}

      <div className="summary-grid">
        <div className="stat-card">
          <div className="stat-value">{fmt(durationSec)}</div>
          <div className="stat-label">时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgPaceSec != null ? `${avgPaceSec}s` : '—'}</div>
          <div className="stat-label">平均节奏 / 次</div>
        </div>
      </div>

      {settings.scriptureEnabled && (
        <p className="hint center">
          《{scripture.title}》第 {charIndex} 字 / 共 {scripture.totalChars} 字（{pct}%），第{' '}
          {scripture.chapterOf(Math.max(0, charIndex - 1))} 章
        </p>
      )}
      {count === 0 && <p className="hint center">次数为 0，本次未保存记录。</p>}

      <button className="btn-primary btn-huge" onClick={() => navigate('home')}>
        完成
      </button>
    </div>
  );
}

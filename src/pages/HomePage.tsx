import { useAppStore } from '../store/useAppStore';
import { computeStreak, todayCount } from '../db/stats';

function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

export function HomePage() {
  const { sessions, navigate, beginPrepare } = useAppStore();
  const today = todayCount(sessions);
  const streak = computeStreak(sessions);

  return (
    <div className="page home">
      <header className="home-header">
        <h1>大礼拜计数</h1>
        <p className="subtitle">专注修行，自动计数</p>
      </header>

      <div className="today-cards">
        <div className="stat-card">
          <div className="stat-value">{today}</div>
          <div className="stat-label">今日已拜</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">连续天数</div>
        </div>
      </div>

      <button className="btn-primary btn-huge" onClick={beginPrepare}>
        开始运动
      </button>

      <nav className="home-nav">
        <button className="btn-text" onClick={() => navigate('stats')}>
          统计
        </button>
        <button className="btn-text" onClick={() => navigate('settings')}>
          设置
        </button>
      </nav>

      {isIOS() && !isStandalone() && (
        <p className="hint">iOS 用户：可通过 Safari「分享 → 添加到主屏幕」安装为应用</p>
      )}
    </div>
  );
}

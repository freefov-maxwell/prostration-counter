import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeStreak, todayCount } from '../db/stats';
import { isWeChat } from '../platform/support';

function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

export function WeChatBanner() {
  if (!isWeChat()) return null;
  return (
    <div className="wechat-banner" role="alert">
      微信内可能无法使用摄像头。请点右上角「···」→「在浏览器中打开」
    </div>
  );
}

function InstallHint() {
  if (!isIOS() || isStandalone()) return null;
  return <p className="hint center">iOS 用户：可通过 Safari「分享 → 添加到主屏幕」安装为应用</p>;
}

const FEATURES = [
  ['自动计数', '识别「站立 → 下拜 → 五体投地 → 起身」完整一拜，起身站稳自动 +1，什么都不用按。'],
  ['听声即知，不用看屏', '识别到下拜一声颂钵，完成一拜一声清磬，达成目标另有提示。'],
  ['语音引导站位', '「请后退一步」「离得太远了」……按提示站好，倒数 5 秒自动开始。'],
  ['每拜一字', '可选开启《道德经》全文随拜推进，进度跨天累计，功课做完，经也读了。'],
  ['离开自动暂停', '接电话、开门，人走出画面即暂停，回来站好自动继续。'],
] as const;

const TRUST = [
  ['视频不出手机', '识别全部在本机完成，不录制、不上传。'],
  ['首次约 16 MB', '第一次开始时下载识别模型，建议连 Wi-Fi；之后断网也能用。'],
  ['无账号、无广告', '记录只存在本机，可在设置中导出备份。'],
] as const;

function Intro({ firstTime, onStart, onSkip }: { firstTime: boolean; onStart(): void; onSkip(): void }) {
  return (
    <div className="page intro">
      <WeChatBanner />
      <header className="home-header">
        <img className="intro-icon" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
        <h1>大礼拜计数</h1>
        <p className="intro-tagline">把手机立在拜垫前，你只管磕头，它来数。</p>
      </header>

      <img
        className="intro-demo"
        src={`${import.meta.env.BASE_URL}demo.svg`}
        alt="示意动画：人做大礼拜，手机屏幕上的计数自动增加，《道德经》逐字前进"
      />

      <section className="section">
        <h3>它能做什么</h3>
        <ul className="feature-list">
          {FEATURES.map(([title, desc]) => (
            <li key={title}>
              <b>{title}</b>
              <span>{desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h3>开始前须知</h3>
        <div className="trust-grid">
          {TRUST.map(([title, desc]) => (
            <div className="stat-card" key={title}>
              <b>{title}</b>
              <p className="hint">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <InstallHint />

      <div className="intro-cta">
        <button className="btn-primary btn-huge" onClick={onStart}>
          {firstTime ? '开始第一次礼拜' : '开始礼拜'}
        </button>
        <button className="btn-text" onClick={onSkip}>
          {firstTime ? '先看看首页' : '返回首页'}
        </button>
      </div>
    </div>
  );
}

export function HomePage() {
  const { sessions, settings, ready, navigate, beginPrepare, updateSettings } = useAppStore();
  const today = todayCount(sessions);
  const streak = computeStreak(sessions);
  const [reopened, setReopened] = useState(false);

  // 已有记录的老用户（含本字段上线前的用户）不再自动弹介绍，可从首页「介绍」重看
  const firstTime = ready && !settings.introSeen && sessions.length === 0;
  if (firstTime || reopened) {
    return (
      <Intro
        firstTime={firstTime}
        onStart={() => {
          void updateSettings({ introSeen: true });
          beginPrepare();
        }}
        onSkip={() => {
          setReopened(false);
          void updateSettings({ introSeen: true });
        }}
      />
    );
  }

  return (
    <div className="page home">
      <WeChatBanner />
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
        开始礼拜
      </button>

      <nav className="home-nav">
        <button className="btn-text" onClick={() => navigate('stats')}>
          统计
        </button>
        <button className="btn-text" onClick={() => navigate('settings')}>
          设置
        </button>
        <button className="btn-text" onClick={() => setReopened(true)}>
          介绍
        </button>
      </nav>

      <InstallHint />
    </div>
  );
}

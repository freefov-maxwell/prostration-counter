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

/** 已从主屏幕打开或在微信内（无法添加，横幅已引导去浏览器）时返回 null。 */
function installSteps(): string | null {
  if (isStandalone() || isWeChat()) return null;
  return isIOS()
    ? '用 Safari 打开，点底部「分享」按钮（新版 iOS 先点「···」）→「添加到主屏幕」'
    : '点浏览器右上角或底部的菜单（⋮ 或 ≡）→「添加到主屏幕」或「安装应用」';
}

function InstallHint() {
  const steps = installSteps();
  if (!steps) return null;
  return <p className="hint center">可添加到主屏幕，像 App 一样使用：{steps}</p>;
}

const INSTALL_STEPS = [
  ['在微信里打开的', '先点右上角「···」→「在浏览器中打开」，再按下面对应机型操作。微信内无法添加到桌面。'],
  ['iPhone / iPad', '用 Safari 打开本页，点底部「分享」按钮（方框带向上箭头；新版 iOS 先点「···」再点「分享」）→「添加到主屏幕」→「添加」。'],
  ['安卓 · Chrome / Edge', '点右上角「⋮」（Edge 在底部「≡」）→「添加到主屏幕」或「安装应用」→「安装」。'],
  ['华为 / 小米 / OPPO / vivo 自带浏览器', '点底部或右上角菜单（≡ 或 ⋮）→「添加到桌面」或「添加快捷方式」。若提示需要权限，在系统设置中允许浏览器「创建桌面快捷方式」。'],
] as const;

/** 介绍页始终展示全部机型，方便用户转告他人；仅在已从桌面图标打开时隐藏。 */
function InstallSection() {
  if (isStandalone()) return null;
  return (
    <section className="section">
      <h3>可以安装到手机桌面</h3>
      <p className="hint">
        从桌面图标打开后：全屏显示、没有地址栏，模型下载过后断网也能用，和 App 体验一样，无需应用商店安装。
      </p>
      <ul className="feature-list">
        {INSTALL_STEPS.map(([title, desc]) => (
          <li key={title}>
            <b>{title}</b>
            <span>{desc}</span>
          </li>
        ))}
      </ul>
      <p className="hint">
        注意：iPhone 上桌面图标与 Safari 里的数据互不相通。如果已在 Safari 中有练习记录，先在「设置 → 导出备份」，再从桌面图标打开后「导入备份」。
      </p>
    </section>
  );
}

const FEATURES = [
  ['自动计数', '识别「站立 → 俯身 → 全身俯卧 → 起身」完整一次动作，起身站稳自动 +1，什么都不用按。'],
  ['听声即知，不用看屏', '识别到俯身一声低音提示，完成一次动作一声高音提示，达成目标另有提示。'],
  ['语音引导站位', '「请后退一步」「离得太远了」……按提示站好，倒数 5 秒自动开始。'],
  ['每次一字', '可选开启《道德经》全文随动作推进，进度跨天累计，练习结束，阅读进度也会保存。'],
  ['离开自动暂停', '接电话、开门，人走出画面即暂停，回来站好自动继续。'],
] as const;

const TRUST = [
  ['视频不出手机', '识别全部在本机完成，不录制、不上传。'],
  ['首次约 4 MB', '第一次开始时下载识别模型，建议连 Wi-Fi；之后断网也能用。'],
  ['无账号、无广告', '记录只存在本机。换手机时在设置中导出备份，新手机上导入即可恢复。'],
] as const;

function Intro({ firstTime, onStart, onSkip }: { firstTime: boolean; onStart(): void; onSkip(): void }) {
  return (
    <div className="page intro">
      <WeChatBanner />
      <header className="home-header">
        <img className="intro-icon" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
        <h1>归元瑜伽计数</h1>
        <p className="intro-tagline">把手机立在垫子前，你只管练习，它来数。</p>
      </header>

      <img
        className="intro-demo"
        src={`${import.meta.env.BASE_URL}demo.svg`}
        alt="示意动画：人做归元瑜伽，手机屏幕上的计数自动增加，《道德经》逐字前进"
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

      <InstallSection />

      <div className="intro-cta">
        <button className="btn-primary btn-huge" onClick={onStart}>
          {firstTime ? '开始第一次练习' : '开始练习'}
        </button>
        <div className="intro-cta-secondary">
          <button className="btn-text" onClick={onSkip}>
            {firstTime ? '先看看首页' : '返回首页'}
          </button>
          <footer className="hint center brand-footer">
            <a href="https://shizhao.org.cn/" target="_blank" rel="noopener noreferrer">时照启明堂</a>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** onUpdate：新版本已下载就绪时提供，点击切换到新版并刷新。 */
export function HomePage({ onUpdate }: { onUpdate?: () => void }) {
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
      {onUpdate && (
        <button className="wechat-banner update-banner" onClick={onUpdate}>
          新版本已就绪，点此更新
        </button>
      )}
      <header className="home-header">
        <h1>归元瑜伽计数</h1>
        <p className="subtitle">专注练习，自动计数</p>
      </header>

      <div className="today-cards">
        <div className="stat-card">
          <div className="stat-value">{today}</div>
          <div className="stat-label">今日已完成</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">连续天数</div>
        </div>
      </div>

      <button className="btn-primary btn-huge" onClick={beginPrepare}>
        开始练习
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
      <footer className="hint center brand-footer">
        <a href="https://shizhao.org.cn/" target="_blank" rel="noopener noreferrer">时照启明堂</a>
      </footer>
    </div>
  );
}

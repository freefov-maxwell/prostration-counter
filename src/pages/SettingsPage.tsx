import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { exportAll } from '../db/db';
import { scripture } from '../scripture';

export function SettingsPage() {
  const { settings, updateSettings, charIndex, jumpChar, resetProgress, navigate } = useAppStore();
  const [jumpValue, setJumpValue] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const pct = ((charIndex / scripture.totalChars) * 100).toFixed(1);
  const chapter = scripture.chapterOf(Math.max(0, charIndex - 1));

  const doExport = async () => {
    const json = await exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dalibai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-text" onClick={() => navigate('home')}>
          ‹ 返回
        </button>
        <h2>设置</h2>
        <span />
      </header>

      <section className="section">
        <h3>经书进度</h3>
        <p className="hint">
          《{scripture.title}》第 {charIndex} 字 / 共 {scripture.totalChars} 字（{pct}%），当前第{' '}
          {chapter} 章
        </p>
        <div className="btn-row">
          <input
            className="input"
            type="number"
            min={0}
            max={scripture.totalChars - 1}
            placeholder="跳转到第 N 字"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
          />
          <button
            className="btn-secondary"
            onClick={() => {
              const n = parseInt(jumpValue, 10);
              if (Number.isFinite(n)) {
                void jumpChar(n);
                setJumpValue('');
              }
            }}
          >
            跳转
          </button>
        </div>
        {confirmReset ? (
          <div className="btn-row">
            <button
              className="btn-danger"
              onClick={() => {
                void resetProgress();
                setConfirmReset(false);
              }}
            >
              确认重置进度
            </button>
            <button className="btn-secondary" onClick={() => setConfirmReset(false)}>
              取消
            </button>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setConfirmReset(true)}>
            重置经书进度
          </button>
        )}
      </section>

      <section className="section">
        <h3>反馈</h3>
        <label className="switch-row">
          <span>提示音</span>
          <input
            type="checkbox"
            checked={settings.soundOn}
            onChange={(e) => void updateSettings({ soundOn: e.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>震动（Android）</span>
          <input
            type="checkbox"
            checked={settings.vibrationOn}
            onChange={(e) => void updateSettings({ vibrationOn: e.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>默认显示《道德经》逐字</span>
          <input
            type="checkbox"
            checked={settings.scriptureEnabled}
            onChange={(e) => void updateSettings({ scriptureEnabled: e.target.checked })}
          />
        </label>
      </section>

      <section className="section">
        <h3>数据</h3>
        <button className="btn-secondary" onClick={() => void doExport()}>
          导出数据（JSON 备份）
        </button>
      </section>

      <section className="section">
        <h3>关于</h3>
        <p className="hint">
          大礼拜计数 v0.1 · 纯本地运行：视频不出设备，数据仅存本机，无任何网络请求与埋点。
          运动中建议插电使用。
        </p>
      </section>
    </div>
  );
}

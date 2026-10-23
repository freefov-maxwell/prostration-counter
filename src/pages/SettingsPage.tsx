import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { exportAll } from '../db/db';
import { downloadJson } from '../platform/overlay';
import { scripture } from '../scripture';

/** 当前字前后一小段原文，当前字高亮，便于记住进度在全文哪里。 */
function ScriptureContext({ index }: { index: number }) {
  const w = scripture.windowAt(index, 12);
  return (
    <p className="scripture-context">
      {w.before}
      <span className="scripture-context-current">{w.current}</span>
      {w.after}
    </p>
  );
}

export function SettingsPage() {
  const { settings, updateSettings, charIndex, jumpChar, resetProgress, navigate } = useAppStore();
  const [jumpValue, setJumpValue] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const pct = ((charIndex / scripture.totalChars) * 100).toFixed(1);
  const chapter = scripture.chapterOf(Math.max(0, charIndex - 1));
  const jumpN = parseInt(jumpValue, 10);
  const jumpPreview = Number.isFinite(jumpN) ? Math.max(0, Math.min(jumpN, scripture.totalChars - 1)) : null;

  const doExport = async () => {
    downloadJson(`dalibai-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll());
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
        <ScriptureContext index={charIndex} />
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
        {jumpPreview != null && (
          <>
            <p className="hint">跳转后（第 {scripture.chapterOf(jumpPreview)} 章）：</p>
            <ScriptureContext index={jumpPreview} />
          </>
        )}
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
          <span>下拜识别提示音（颂钵）</span>
          <input
            type="checkbox"
            checked={settings.descentCueOn !== false}
            onChange={(e) => void updateSettings({ descentCueOn: e.target.checked })}
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
        <h3>调试</h3>
        <label className="switch-row">
          <span>相机页显示骨架与识别数值</span>
          <input
            type="checkbox"
            checked={!!settings.debugOverlay}
            onChange={(e) => void updateSettings({ debugOverlay: e.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>使用高精度识别模型 MediaPipe</span>
          <input
            type="checkbox"
            checked={settings.poseModel === 'mediapipe'}
            onChange={(e) => void updateSettings({ poseModel: e.target.checked ? 'mediapipe' : 'movenet' })}
          />
        </label>
        <p className="hint">默认的轻量模型计数不准时可开启。识别更稳，但首次使用另需下载约 17 MB，手机负担更重，需浏览器支持 WebGL2。</p>
      </section>

      <section className="section">
        <h3>关于</h3>
        <p className="hint">
          大礼拜计数 v0.1 · 纯本地运行：视频不出设备，数据仅存本机，无任何网络请求与埋点。
          运动中建议插电使用。提示语音为 AI 合成。
        </p>
      </section>
    </div>
  );
}

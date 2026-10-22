import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { initAudio } from '../platform/feedback';

export function PreparePage() {
  const { settings, updateSettings, beginSession, navigate } = useAppStore();
  const [targetChoice, setTargetChoice] = useState<'none' | '108' | 'custom'>(
    settings.defaultTarget === 108 ? '108' : settings.defaultTarget ? 'custom' : 'none',
  );
  const [customTarget, setCustomTarget] = useState(String(settings.defaultTarget ?? ''));

  const resolveTarget = (): number | null => {
    if (targetChoice === '108') return 108;
    if (targetChoice === 'custom') {
      const n = parseInt(customTarget, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  };

  const start = () => {
    // 音频必须在用户手势中初始化
    initAudio();
    const target = resolveTarget();
    void updateSettings({ defaultTarget: target ?? undefined });
    beginSession(target);
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-text" onClick={() => navigate('home')}>
          ‹ 返回
        </button>
        <h2>准备</h2>
        <span />
      </header>

      <section className="section">
        <h3>本次目标</h3>
        <div className="option-row">
          <button
            className={targetChoice === 'none' ? 'chip chip-active' : 'chip'}
            onClick={() => setTargetChoice('none')}
          >
            无目标
          </button>
          <button
            className={targetChoice === '108' ? 'chip chip-active' : 'chip'}
            onClick={() => setTargetChoice('108')}
          >
            108 拜
          </button>
          <button
            className={targetChoice === 'custom' ? 'chip chip-active' : 'chip'}
            onClick={() => setTargetChoice('custom')}
          >
            自定义
          </button>
        </div>
        {targetChoice === 'custom' && (
          <input
            className="input"
            type="number"
            min={1}
            placeholder="输入目标次数"
            value={customTarget}
            onChange={(e) => setCustomTarget(e.target.value)}
          />
        )}
      </section>

      <section className="section">
        <h3>选项</h3>
        <label className="switch-row">
          <span>显示《道德经》逐字</span>
          <input
            type="checkbox"
            checked={settings.scriptureEnabled}
            onChange={(e) => void updateSettings({ scriptureEnabled: e.target.checked })}
          />
        </label>
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
          <span>震动（Android）</span>
          <input
            type="checkbox"
            checked={settings.vibrationOn}
            onChange={(e) => void updateSettings({ vibrationOn: e.target.checked })}
          />
        </label>
      </section>

      <button className="btn-primary btn-huge" onClick={start}>
        开始
      </button>
    </div>
  );
}

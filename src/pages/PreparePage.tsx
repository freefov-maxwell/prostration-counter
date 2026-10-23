import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { initAudio, playQing } from '../platform/feedback';

/** 侧视示意：站立预备 → 跪下 → 趴下伸手，手指前方给手机留出距离。三帧循环。 */
function PlacementGuide() {
  return (
    <section className="section">
      <h3>手机摆放</h3>
      <svg className="placement" viewBox="0 0 320 160" role="img" aria-label="手机摆放示意：手机竖放在地上略向后仰，人趴下伸直手臂后，指尖前方留约 10 到 20 厘米">
        <line className="pg-floor" x1="8" y1="128" x2="312" y2="128" />
        <g className="pg-phone">
          <g transform="rotate(10 292 128)">
            <rect x="288.5" y="82" width="7" height="46" rx="1.5" />
            <circle cx="290.5" cy="87" r="1.4" className="pg-lens" />
          </g>
          <text x="292" y="74" textAnchor="middle">手机</text>
        </g>
        <g className="pg-frame pg-f1">
          <polygon className="pg-fov" points="289,88 24,10 24,128" />
          <circle cx="70" cy="52" r="8" />
          <path d="M70 61 L70 92 M70 92 L65 127 M70 92 L75 127 M70 65 L67 92 M70 65 L73 92" />
          <text x="12" y="20">① 站直、双手下垂，全身入镜</text>
        </g>
        <g className="pg-frame pg-f2">
          <circle cx="122" cy="96" r="8" />
          <path d="M55 127 L78 127 L82 104 L112 100 M112 100 L118 127" />
          <text x="12" y="20">② 跪下、手撑地</text>
        </g>
        <g className="pg-frame pg-f3">
          <circle cx="214" cy="111" r="8" />
          <path d="M60 124 L130 123 L205 121 M205 121 L266 124" />
          <path className="pg-dim" d="M268 138 L286 138 M268 133 L268 143 M286 133 L286 143" />
          <text x="277" y="154" textAnchor="middle" className="pg-dim-label">留 10–20cm</text>
          <text x="12" y="20">③ 趴下伸手，指尖碰不到手机</text>
        </g>
      </svg>
      <ul className="placement-tips">
        <li>手机竖放，屏幕朝向你，底部着地、略向后仰（可靠在水杯或书上）</li>
        <li>放在你趴下伸直手臂后，指尖前方约 10–20 厘米处（碰不到即可）</li>
        <li>站在起始位置时，头到脚都要在画面里；光线充足效果更好</li>
      </ul>
    </section>
  );
}

export function PreparePage() {
  const { settings, updateSettings, beginSession, navigate } = useAppStore();
  const [targetChoice, setTargetChoice] = useState<'none' | '36' | '108' | 'custom'>(
    settings.defaultTarget === 36 ? '36' : settings.defaultTarget === 108 ? '108' : settings.defaultTarget ? 'custom' : 'none',
  );
  const [customTarget, setCustomTarget] = useState(String(settings.defaultTarget ?? ''));

  const resolveTarget = (): number | null => {
    if (targetChoice === '36') return 36;
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

      <PlacementGuide />

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
            className={targetChoice === '36' ? 'chip chip-active' : 'chip'}
            onClick={() => setTargetChoice('36')}
          >
            36 次
          </button>
          <button
            className={targetChoice === '108' ? 'chip chip-active' : 'chip'}
            onClick={() => setTargetChoice('108')}
          >
            108 次
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
      </section>

      <section className="section">
        <h3>声音</h3>
        <p className="hint">练习全程靠提示音和语音引导，开始前请试听确认。不想太响可调小音量，但不要调到静音。</p>
        <button
          className="btn-secondary"
          onClick={async () => {
            await initAudio();
            playQing();
          }}
        >
          试听提示音
        </button>
        <p className="hint">
          听不到时：① 用音量键调大<b>媒体音量</b>（不是铃声音量）；② iPhone 拨开机身侧边的静音键；③ 关闭勿扰/专注模式；④ 检查是否连着蓝牙耳机或音箱；⑤ 在微信里打开时，退出重进页面再试。
        </p>
      </section>

      <button className="btn-primary btn-huge" onClick={start}>
        开始
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useAppStore, sessionDurationSec } from '../store/useAppStore';
import { usePoseLoop } from '../platform/usePoseLoop';
import { LoadProgress } from '../platform/pose';
import { analyzeStandingFrame, SignalExtractor } from '../engine/signals';
import { initialMachineState, MachineState, RepState, stepMachine } from '../engine/stateMachine';
import { DEFAULT_THRESHOLDS } from '../engine/thresholds';
import { FrameSignals, PoseFrame } from '../engine/types';
import { playBowl, playGoal, playQing, playVoice, preloadVoices, vibrate, VoiceKey } from '../platform/feedback';
import { downloadJson, drawPose } from '../platform/overlay';
import { scripture } from '../scripture';

type PositionKey = 'enter' | 'headOut' | 'feetOut' | 'tooFar' | 'pose' | 'hold';

/** 远距离可读的大字提示（语音同步播报 scripts/voice-lines.json 中的完整句子）。 */
const POSITION_TEXT: Record<PositionKey, string> = {
  enter: '请走入画面',
  headOut: '头部出画\n请后退一步',
  feetOut: '脚部出画\n请后退一步',
  tooFar: '太远了\n请靠近一点',
  pose: '请站直\n双手下垂',
  hold: '很好\n保持不动',
};

/** 状态稳定这么久才播报，避免识别抖动时连播。 */
const VOICE_SETTLE_MS = 800;
/** 站位问题持续存在时的重复播报间隔（人站得远，可能没听清）。 */
const VOICE_REPEAT_MS = 8000;
/** 调试导出保留的帧数（约 3 分钟 @30fps）。 */
const DEBUG_FRAMES = 5400;
const RING_C = 2 * Math.PI * 92;

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const isArmed = (s: RepState) => s === 'PRONE' || s === 'RISING';

export function SessionPage() {
  const store = useAppStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugRef = useRef<HTMLPreElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [goalReached, setGoalReached] = useState(false);
  const [counting, setCounting] = useState(false);
  const [posKey, setPosKey] = useState<PositionKey>('enter');
  const [flashKey, setFlashKey] = useState(0);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [, setTick] = useState(0);

  const countingRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);
  const posSamplesRef = useRef<{ H: number; noseY: number; sw: number; ew: number }[]>([]);
  const extractorRef = useRef<SignalExtractor | null>(null);
  const machineRef = useRef<MachineState>(initialMachineState());
  const debugFramesRef = useRef<(FrameSignals & { state: RepState })[]>([]);
  const voiceRef = useRef({ key: null as VoiceKey | null, since: 0, spoken: null as VoiceKey | null, at: 0 });

  useEffect(() => {
    preloadVoices(['enter', 'headOut', 'feetOut', 'tooFar', 'pose', 'hold', 'ready', 'discarded', 'paused', 'resumed', 'goal']);
  }, []);

  // 每秒刷新计时显示
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // 运动中保持屏幕常亮；切后台会自动释放，回前台重新申请
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator)
        navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined);
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      document.removeEventListener('visibilitychange', request);
      void lock?.release();
    };
  }, []);

  // 切后台中断后重置状态机，避免恢复时把中断前的半个周期计入
  useEffect(() => {
    if (store.sessionStatus === 'interrupted') machineRef.current = initialMachineState();
  }, [store.sessionStatus]);

  const speak = (key: VoiceKey, t: number) => {
    voiceRef.current = { key, since: t, spoken: key, at: t };
    if (useAppStore.getState().settings.soundOn) playVoice(key);
  };

  /** 站位提示：稳定后播一次，问题未解决则定期重复。 */
  const guide = (key: VoiceKey, t: number) => {
    const v = voiceRef.current;
    if (v.key !== key) {
      v.key = key;
      v.since = t;
    }
    if (t - v.since < VOICE_SETTLE_MS) return;
    if (v.spoken === key && (key === 'hold' || t - v.at < VOICE_REPEAT_MS)) return;
    speak(key, t);
  };

  const onPositionFrame = (frame: PoseFrame, t: number) => {
    const th = DEFAULT_THRESHOLDS;
    const a = analyzeStandingFrame(frame);
    let key: PositionKey;
    if (!a.hasPerson) key = 'enter';
    else if (a.headOutTop) key = 'headOut';
    // 脚踝不可见也按脚部出画处理（多为画面下缘裁掉或被遮挡）
    else if (a.feetOutBottom || a.height == null) key = 'feetOut';
    else if (a.height < th.targetHeightMin) key = 'tooFar';
    // 预备姿势：站直、腿伸直、双手自然下垂（蹲在镜头前、T 字、举手都不算）
    else if (!a.legsStraight || !a.armsDown || a.shoulderW == null) key = 'pose';
    else key = 'hold';
    const ok = key === 'hold';
    setPosKey(key);
    guide(key, t);
    if (canvasRef.current && videoRef.current) drawPose(canvasRef.current, videoRef.current, frame, ok, th.inFrameMargin);
    if (debugRef.current)
      debugRef.current.textContent =
        `H=${a.height?.toFixed(3)} 肩宽=${a.shoulderW?.toFixed(3)} 直立=${a.upright} 腿直=${a.legsStraight} 手垂=${a.armsDown}`;

    // 保持期间晃动过大也视为没站稳，重新计时
    const ys = posSamplesRef.current.map((s) => s.noseY);
    const drifted = ok && ys.length > 0 && Math.max(...ys, a.noseY!) - Math.min(...ys, a.noseY!) > th.readyMaxDrift;
    if (!ok || drifted) {
      stableSinceRef.current = null;
      posSamplesRef.current = [];
      return;
    }
    stableSinceRef.current ??= t;
    posSamplesRef.current.push({ H: a.height!, noseY: a.noseY!, sw: a.shoulderW!, ew: a.earW ?? 0 });
    if (t - stableSinceRef.current < th.positionHoldMs) return;

    const ss = posSamplesRef.current;
    extractorRef.current = new SignalExtractor({
      H: median(ss.map((s) => s.H)),
      noseY0: median(ss.map((s) => s.noseY)),
      shoulderW0: median(ss.map((s) => s.sw)),
      earW0: median(ss.map((s) => s.ew)),
    });
    machineRef.current = initialMachineState(t);
    countingRef.current = true;
    setCounting(true);
    useAppStore.getState().startRunning();
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setFlashKey((k) => k + 1);
    speak('ready', t);
  };

  const onFrame = (frame: PoseFrame, t: number) => {
    const s = useAppStore.getState();
    // autoPaused 时仍要跑状态机以检测人回来（resumed 事件）；interrupted 时完全停止
    if (s.sessionStatus === 'interrupted') return;
    if (!countingRef.current || !extractorRef.current) {
      onPositionFrame(frame, t);
      return;
    }
    const sig = extractorRef.current.update(frame, t);
    const { state, events } = stepMachine(machineRef.current, sig);
    machineRef.current = state;

    // 圆环：下拜中随低位程度填充，上膛后填满
    const progress = isArmed(state.state) ? 1 : state.state === 'DESCENDING' ? Math.min(1, Math.max(0, sig.lowness)) : 0;
    ringRef.current?.setAttribute('stroke-dashoffset', String(RING_C * (1 - progress)));

    if (s.settings.debugOverlay) {
      if (canvasRef.current && videoRef.current) drawPose(canvasRef.current, videoRef.current, frame, null, 0);
      if (debugRef.current)
        debugRef.current.textContent =
          `${state.state} q=${sig.quality} 站直=${sig.standing} 低位=${sig.lowness.toFixed(2)} ` +
          `头降=${sig.headDrop?.toFixed(2)} 远近=${sig.scale?.toFixed(2)} 身高=${sig.heightRatio?.toFixed(2)} 直立=${sig.upright}`;
      const buf = debugFramesRef.current;
      buf.push({ ...sig, state: state.state });
      if (buf.length > DEBUG_FRAMES) buf.splice(0, buf.length - DEBUG_FRAMES);
    }

    const sound = s.settings.soundOn;
    for (const e of events) {
      if (e.type === 'armed') {
        if (sound && s.settings.descentCueOn !== false) playBowl();
      } else if (e.type === 'repCompleted') {
        s.onRepCompleted();
        setFlashKey((k) => k + 1);
        const after = useAppStore.getState();
        if (sound) playQing();
        if (after.settings.vibrationOn) vibrate(30);
        if (after.target != null && after.sessionCount === after.target) {
          setGoalReached(true);
          if (sound) {
            playGoal();
            setTimeout(() => speak('goal', performance.now()), 1200);
          }
          if (after.settings.vibrationOn) vibrate([60, 80, 60]);
        }
      } else if (e.type === 'repDiscarded') {
        speak('discarded', t);
      } else if (e.type === 'paused') {
        s.autoPause();
        // 同一帧已播"本次未计入"时不再覆盖
        if (!events.some((x) => x.type === 'repDiscarded')) speak('paused', t);
      } else if (e.type === 'resumed') {
        s.autoResume();
        speak('resumed', t);
      } else if (e.type === 'stateChanged') {
        s.setMachineState(e.to);
        if (e.to === 'STANDING') extractorRef.current.rebase();
      }
    }
  };

  const stage = usePoseLoop(videoRef, { onFrame, onError: setError, onProgress: setProgress }, retryKey);

  const exportFrames = () =>
    downloadJson(
      `dalibai-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      JSON.stringify({ thresholds: DEFAULT_THRESHOLDS, frames: debugFramesRef.current }),
    );

  const { sessionCount, target, settings, charIndex, sessionStatus, machineState } = store;
  const durationSec = sessionDurationSec(store);
  const win = settings.scriptureEnabled ? scripture.windowAt(charIndex, 6) : null;
  const debug = !!settings.debugOverlay;

  return (
    <div className="page camera-page session-page">
      <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
      {(!counting || debug) && <canvas ref={canvasRef} className="camera-preview pose-canvas" />}
      {debug && <pre ref={debugRef} className="debug-readout" />}
      <div className={`edge-glow${counting && isArmed(machineState) ? ' armed' : ''}`} />
      {flashKey > 0 && <div key={flashKey} className="edge-flash" />}

      {!counting ? (
        <div className="session-top">
          <header className="page-header overlay-header">
            <button className="btn-text" onClick={() => store.navigate('prepare')}>
              ‹ 返回
            </button>
            <h2>站位</h2>
            <span />
          </header>
          {error && (
            <div className="panel">
              <p>{error}</p>
              <div className="btn-row">
                <button
                  className="btn-primary"
                  onClick={() => {
                    setError(null);
                    setProgress(null);
                    setRetryKey((k) => k + 1);
                  }}
                >
                  重试
                </button>
                <button className="btn-secondary" onClick={() => store.navigate('home')}>
                  返回首页
                </button>
              </div>
            </div>
          )}
          {stage === 'loading' && !error && (
            <div className="panel">
              <p className="guidance">首次使用需下载识别资源（约 16 MB），之后离线可用</p>
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{
                    width:
                      progress && progress.total > 0
                        ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                        : '100%',
                  }}
                />
              </div>
              <p className="hint">
                {progress
                  ? `${(progress.loaded / 1048576).toFixed(1)}${progress.total > 0 ? ` / ${(progress.total / 1048576).toFixed(1)}` : ''} MB`
                  : '正在准备…'}
              </p>
            </div>
          )}
          {stage === 'ready' && !error && (
            <>
              <div className={`guide-big ${posKey === 'hold' ? 'tone-ok' : 'tone-warn'}`}>{POSITION_TEXT[posKey]}</div>
              <p className="hint position-hint">
                手机立于地面略向后仰，放在趴下后手臂前伸碰不到的位置。全身站进虚线框，框变绿后保持不动即开始。
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="session-top">
          <div className="count-ring">
            <svg className="ring-svg" viewBox="0 0 200 200" aria-hidden="true">
              <circle className="ring-track" cx="100" cy="100" r="92" />
              <circle
                ref={ringRef}
                className="ring-fill"
                cx="100"
                cy="100"
                r="92"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C}
              />
            </svg>
            <div key={flashKey} className="big-count count-pop">{sessionCount}</div>
          </div>
          {target != null && (
            <div className="target-progress">
              目标 {sessionCount} / {target}
              {goalReached && <span className="goal-badge">目标已达成</span>}
            </div>
          )}
          <div className="duration">{fmtDuration(durationSec)}</div>
          {win && (
            <div className="scripture-line">
              <span className="ctx">{win.before}</span>
              <span className="current-char">{win.current}</span>
              <span className="ctx">{win.after}</span>
            </div>
          )}
          {error && <div className="panel"><p>{error}</p></div>}
        </div>
      )}

      {counting && (
        <div className="session-controls">
          <button className="btn-circle" onClick={() => store.adjust(-1)} aria-label="减一">
            −1
          </button>
          <button className="btn-circle btn-plus" onClick={() => store.adjust(1)} aria-label="加一">
            +1
          </button>
          <button className="btn-secondary" onClick={() => setConfirmReset(true)}>
            清零
          </button>
          <button className="btn-primary" onClick={() => void store.endSession()}>
            结束
          </button>
          {debug && (
            <button className="btn-secondary" onClick={exportFrames}>
              导出运动数据
            </button>
          )}
        </div>
      )}

      {sessionStatus === 'autoPaused' && (
        <div className="overlay-mask">
          <p>检测不到人，已自动暂停</p>
          <p className="hint">站回画面将自动继续</p>
        </div>
      )}
      {sessionStatus === 'interrupted' && (
        <div className="overlay-mask">
          <p>会话已中断</p>
          <button className="btn-primary" onClick={() => store.resumeFromInterrupt()}>
            继续
          </button>
          <button className="btn-secondary" onClick={() => void store.endSession()}>
            结束并保存
          </button>
        </div>
      )}

      {confirmReset && (
        <div className="overlay-mask">
          <p>确定将本次计数清零？</p>
          <div className="btn-row">
            <button
              className="btn-danger"
              onClick={() => {
                store.resetCount();
                setConfirmReset(false);
              }}
            >
              确认清零
            </button>
            <button className="btn-secondary" onClick={() => setConfirmReset(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

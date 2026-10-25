import { useEffect, useRef, useState } from 'react';
import { useAppStore, sessionDurationSec } from '../store/useAppStore';
import { usePoseLoop } from '../platform/usePoseLoop';
import { LoadProgress } from '../platform/pose';
import { analyzeStandingFrame, SignalExtractor } from '../engine/signals';
import { initialMachineState, MachineEvent, MachineState, RepState, stepMachine } from '../engine/stateMachine';
import { DEFAULT_THRESHOLDS } from '../engine/thresholds';
import { SubjectTracker } from '../engine/subject';
import { Baseline, FrameSignals, KP, Keypoint, PoseFrame } from '../engine/types';
import { audioReady, initAudio, playBowl, playGoal, playQing, playTick, playVoice, preloadVoices, VoiceKey } from '../platform/feedback';
import { downloadJson, drawPose } from '../platform/overlay';
import { chapterName, scripture } from '../scripture';
import { ChapterWindow } from './ChapterWindow';

type PositionKey = 'enter' | 'headOut' | 'feetOut' | 'tooFar' | 'pose' | 'hold';

/** 远距离可读的大字提示。 */
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
/** 调试导出保留最近这么久的逐帧数据（含站位阶段）。 */
const DEBUG_WINDOW_MS = 5 * 60 * 1000;
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
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 调试导出的一帧：原始关键点（33 × [x, y, z, visibility]）+ 计数阶段的信号与状态，可离线回放任意版本算法。 */
interface DebugFrame {
  t: number;
  kp: number[] | null;
  /** 画面中其余的人（MediaPipe 多人识别时），格式同 kp。 */
  alt?: number[][];
  /** 推理耗时 ms。 */
  ms?: number;
  st?: RepState;
  sig?: Pick<FrameSignals, 'quality' | 'standing' | 'lowness' | 'headDrop' | 'scale' | 'heightRatio' | 'upright'>;
}

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
  const [countdown, setCountdown] = useState<number | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [, setTick] = useState(0);

  const countingRef = useRef(false);
  /** 倒数：开始时刻、姿态不合格的起点、上次显示的秒数。 */
  const readyRef = useRef({ since: null as number | null, lostAt: null as number | null, lastSec: 0 });
  const posSamplesRef = useRef<{ t: number; H: number; noseX: number; noseY: number; sw: number; ew: number }[]>([]);
  const extractorRef = useRef<SignalExtractor | null>(null);
  const machineRef = useRef<MachineState>(initialMachineState());
  const debugRef2 = useRef({ frames: [] as DebugFrame[], events: [] as (MachineEvent & { t: number })[], baseline0: null as Baseline | null });
  const voiceRef = useRef({ key: null as VoiceKey | null, since: 0, spoken: null as VoiceKey | null, at: 0 });
  // 只有 MediaPipe 能同时识别多人，从中挑出本人；MoveNet 单人模型直接用唯一结果
  const [tracker] = useState(() => ((store.settings.poseModel ?? 'movenet') === 'mediapipe' ? new SubjectTracker() : null));

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
    playVoice(key);
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

    // 站好且静止满一个窗口（readyWindowMs）才开始倒数；倒数中一旦移动、或姿态不合格超过宽限（readyGraceMs，防识别抖动），回到站位调整
    const r = readyRef.current;
    const samples = posSamplesRef.current;
    const backToAdjust = () => {
      if (r.since != null) {
        r.since = null;
        setCountdown(null);
      }
    };
    if (!ok) {
      r.lostAt ??= t;
      if (t - r.lostAt > th.readyGraceMs) {
        posSamplesRef.current = [];
        backToAdjust();
      }
      return;
    }
    r.lostAt = null;
    samples.push({ t, H: a.height!, noseX: frame![KP.nose].x, noseY: a.noseY!, sw: a.shoulderW!, ew: a.earW ?? 0 });
    // 保留一个刚好越过窗口边界的样本，用来判断窗口是否已攒满
    while (samples.length > 1 && t - samples[1].t >= th.readyWindowMs) samples.shift();
    const range = (vs: number[]) => Math.max(...vs) - Math.min(...vs);
    const moving =
      range(samples.map((s) => s.noseY)) > th.readyMaxDrift ||
      range(samples.map((s) => s.noseX)) > th.readyMaxDrift ||
      range(samples.map((s) => s.H)) / median(samples.map((s) => s.H)) > th.readyMaxScaleDrift;
    if (moving) {
      backToAdjust();
      return;
    }
    if (r.since == null) {
      if (t - samples[0].t < th.readyWindowMs) return;
      r.since = t;
      r.lastSec = 0;
    }
    const remain = Math.ceil((th.countdownMs - (t - r.since)) / 1000);
    if (remain > 0) {
      if (remain !== r.lastSec) {
        r.lastSec = remain;
        setCountdown(remain);
        playTick();
      }
      return;
    }
    // 倒数结束：窗口内各帧已保证静止，直接取作基准
    const baseline: Baseline = {
      H: median(samples.map((s) => s.H)),
      noseY0: median(samples.map((s) => s.noseY)),
      shoulderW0: median(samples.map((s) => s.sw)),
      earW0: median(samples.map((s) => s.ew)),
    };
    debugRef2.current.baseline0 = baseline;
    extractorRef.current = new SignalExtractor(baseline);
    setCountdown(null);
    machineRef.current = initialMachineState(t);
    countingRef.current = true;
    setCounting(true);
    useAppStore.getState().startRunning();
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setFlashKey((k) => k + 1);
    speak('ready', t);
  };

  const onFrame = (poses: Keypoint[][], t: number, inferMs: number) => {
    const s = useAppStore.getState();
    // autoPaused 时仍要跑状态机以检测人回来（resumed 事件）；interrupted 时完全停止
    if (s.sessionStatus === 'interrupted') return;
    const frame: PoseFrame = tracker ? tracker.pick(poses, t) : (poses[0] ?? null);
    const dbg = s.settings.debugOverlay ? debugRef2.current : null;
    if (dbg) {
      const flat = (f: Keypoint[]) => f.flatMap((k) => [r3(k.x), r3(k.y), r2(k.z), r2(k.visibility)]);
      const alt = poses.filter((p) => p !== frame).map(flat);
      dbg.frames.push({
        t: Math.round(t),
        ms: Math.round(inferMs),
        kp: frame ? flat(frame) : null,
        ...(alt.length ? { alt } : {}),
      });
      const cut = dbg.frames.findIndex((f) => t - f.t <= DEBUG_WINDOW_MS);
      if (cut > 0) dbg.frames.splice(0, cut);
    }
    if (!countingRef.current || !extractorRef.current) {
      onPositionFrame(frame, t);
      return;
    }
    const sig = extractorRef.current.update(frame, t);
    const { state, events } = stepMachine(machineRef.current, sig);
    machineRef.current = state;

    // 圆环：俯身中随低位程度填充，上膛后填满
    const progress = isArmed(state.state) ? 1 : state.state === 'DESCENDING' ? Math.min(1, Math.max(0, sig.lowness)) : 0;
    ringRef.current?.setAttribute('stroke-dashoffset', String(RING_C * (1 - progress)));

    if (dbg) {
      if (canvasRef.current && videoRef.current) drawPose(canvasRef.current, videoRef.current, frame, null, 0);
      if (debugRef.current)
        debugRef.current.textContent =
          `${state.state} q=${sig.quality} 站直=${sig.standing} 低位=${sig.lowness.toFixed(2)} ` +
          `头降=${sig.headDrop?.toFixed(2)} 远近=${sig.scale?.toFixed(2)} 身高=${sig.heightRatio?.toFixed(2)} 直立=${sig.upright}`;
      const last = dbg.frames[dbg.frames.length - 1];
      last.st = state.state;
      last.sig = {
        quality: sig.quality,
        standing: sig.standing,
        lowness: r3(sig.lowness),
        headDrop: sig.headDrop == null ? null : r3(sig.headDrop),
        scale: sig.scale == null ? null : r3(sig.scale),
        heightRatio: sig.heightRatio == null ? null : r3(sig.heightRatio),
        upright: sig.upright,
      };
      for (const e of events) dbg.events.push({ ...e, t: Math.round(t) });
    }

    for (const e of events) {
      if (e.type === 'armed') {
        playBowl();
      } else if (e.type === 'repCompleted') {
        s.onRepCompleted();
        setFlashKey((k) => k + 1);
        const after = useAppStore.getState();
        playQing();
        if (after.target != null && after.sessionCount === after.target) {
          setGoalReached(true);
          playGoal();
          setTimeout(() => speak('goal', performance.now()), 1200);
        }
      } else if (e.type === 'repDiscarded') {
        speak('discarded', t);
      } else if (e.type === 'paused') {
        tracker?.release();
        s.autoPause();
        // 同一帧已播"本次未计入"时不再覆盖
        if (!events.some((x) => x.type === 'repDiscarded')) speak('paused', t);
      } else if (e.type === 'resumed') {
        s.autoResume();
        speak('resumed', t);
      } else if (e.type === 'settled') {
        extractorRef.current.rebase();
        tracker?.anchor();
      } else if (e.type === 'reanchor') {
        extractorRef.current.reanchor();
        tracker?.anchor();
      } else if (e.type === 'stateChanged') {
        s.setMachineState(e.to);
      }
    }
  };

  const poseModel = store.settings.poseModel ?? 'movenet';
  const stage = usePoseLoop(videoRef, { onFrame, onError: setError, onProgress: setProgress, model: poseModel }, retryKey);

  const exportFrames = () => {
    const d = debugRef2.current;
    downloadJson(
      `dalibai-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      JSON.stringify({
        version: 3,
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        video: { w: videoRef.current?.videoWidth, h: videoRef.current?.videoHeight },
        poseModel,
        kpFormat: 'BlazePose 33 点，每点 [x, y, z, visibility]，x/y 为帧宽高归一化（movenet 只有 17 点，其余 visibility 为 0）；alt 为画面中其余的人',
        thresholds: DEFAULT_THRESHOLDS,
        baseline0: d.baseline0,
        baseline: extractorRef.current?.getBaseline() ?? null,
        events: d.events,
        frames: d.frames,
      }),
    );
  };

  const { sessionCount, target, settings, charIndex, sessionStatus, machineState } = store;
  const durationSec = sessionDurationSec(store);
  const debug = !!settings.debugOverlay;

  return (
    <div className="page camera-page session-page">
      <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
      {/* 计数时压暗画面，让计数和经文更醒目，仍能大致看到自己 */}
      {counting && <div className="camera-dim" />}
      {(!counting || debug) && <canvas ref={canvasRef} className="camera-preview pose-canvas" />}
      {debug && <pre ref={debugRef} className="debug-readout" />}
      <div className={`edge-glow${counting && isArmed(machineState) ? ' armed' : ''}`} />
      {flashKey > 0 && <div key={flashKey} className="edge-flash" />}
      {/* 每秒的计时刷新会重新求值，被系统挂起后即显示 */}
      {!audioReady() && sessionStatus !== 'interrupted' && (
        <button className="wechat-banner sound-banner" onClick={initAudio}>
          🔇 声音已暂停，点此恢复
        </button>
      )}

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
              <p className="guidance">首次使用需下载识别资源（约 {poseModel === 'mediapipe' ? 17 : 6} MB），之后离线可用</p>
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
              <div className={`guide-big ${posKey === 'hold' ? 'tone-ok' : 'tone-warn'}`}>
                {POSITION_TEXT[posKey]}
                {countdown != null && <div className="countdown-num">{countdown > 0 ? countdown : '…'}</div>}
              </div>
              <p className="hint position-hint">
                全身站进虚线框，站直、双手自然下垂。框变绿后倒数 5 秒，倒数中仍可微调位置。
              </p>
              {debug && (
                <div className="btn-row">
                  <button className="btn-secondary" onClick={exportFrames}>
                    导出运动数据
                  </button>
                </div>
              )}
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
          {error && <div className="panel"><p>{error}</p></div>}
        </div>
      )}

      {counting && settings.scriptureEnabled && (
        <div className="scripture-stage">
          <div className="chapter-label">{chapterName(scripture.chapterOf(charIndex))}</div>
          <div className="current-char">{scripture.chars[charIndex]}</div>
          <ChapterWindow index={charIndex} className="ctx" />
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
          <button
            className="btn-primary"
            onClick={() => {
              initAudio();
              store.resumeFromInterrupt();
            }}
          >
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

import { useEffect, useRef, useState } from 'react';
import { useAppStore, sessionDurationSec } from '../store/useAppStore';
import { usePoseLoop } from '../platform/usePoseLoop';
import { SignalExtractor } from '../engine/signals';
import { initialMachineState, MachineState, stepMachine } from '../engine/stateMachine';
import { DEFAULT_THRESHOLDS } from '../engine/thresholds';
import { personalizeThresholds } from '../engine/trial';
import { drawPose } from '../platform/overlay';
import { playGoal, playTick, vibrate } from '../platform/feedback';
import { scripture } from '../scripture';

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SessionPage() {
  const store = useAppStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugRef = useRef<HTMLPreElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [goalReached, setGoalReached] = useState(false);
  const [, setTick] = useState(0);

  const extractorRef = useRef<SignalExtractor | null>(null);
  const machineRef = useRef<MachineState>(initialMachineState());
  const nearFlagRef = useRef(false);

  // 有试拜实测深度则用个性化阈值，否则退回默认值
  const thRef = useRef(
    store.settings.trialHeadDropPeak ? personalizeThresholds(store.settings.trialHeadDropPeak) : DEFAULT_THRESHOLDS,
  );
  if (!extractorRef.current && store.baseline) {
    extractorRef.current = new SignalExtractor(store.baseline, thRef.current);
  }

  // 每秒刷新计时显示
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // 切后台中断后重置状态机，避免恢复时把中断前的半个周期计入
  useEffect(() => {
    if (store.sessionStatus === 'interrupted') {
      machineRef.current = initialMachineState();
      nearFlagRef.current = false;
    }
  }, [store.sessionStatus]);

  const onFrame = (frame: import('../engine/types').PoseFrame, t: number) => {
    const s = useAppStore.getState();
    // autoPaused 时仍要跑状态机以检测人回来（resumed 事件）；interrupted 时完全停止
    if (s.sessionStatus === 'interrupted' || !extractorRef.current) return;
    const sig = extractorRef.current.update(frame, t);
    const { state, events } = stepMachine(machineRef.current, sig, thRef.current);
    machineRef.current = state;
    if (s.settings.debugOverlay) {
      if (canvasRef.current && videoRef.current) drawPose(canvasRef.current, videoRef.current, frame, null, 0);
      if (debugRef.current)
        debugRef.current.textContent =
          `${state.state} q=${sig.quality} head=${sig.headDrop?.toFixed(2)} hip=${sig.hipDrop?.toFixed(2)} ` +
          `close=${sig.closeness} prone>${thRef.current.proneHeadDrop.toFixed(2)}`;
    }

    // 运动中轻量值守：每拜手部越过警戒线记一次"近界事件"
    if (sig.handMaxY != null && sig.handMaxY > DEFAULT_THRESHOLDS.collisionBlockY) {
      if (!nearFlagRef.current) {
        nearFlagRef.current = true;
        s.addNearBoundary();
      }
    }

    for (const e of events) {
      if (e.type === 'repCompleted') {
        nearFlagRef.current = false;
        s.onRepCompleted();
        const after = useAppStore.getState();
        if (after.settings.soundOn) playTick();
        if (after.settings.vibrationOn) vibrate(30);
        if (after.target != null && after.sessionCount === after.target) {
          setGoalReached(true);
          if (after.settings.soundOn) playGoal();
          if (after.settings.vibrationOn) vibrate([60, 80, 60]);
        }
      } else if (e.type === 'paused') {
        s.autoPause();
      } else if (e.type === 'resumed') {
        s.autoResume();
      } else if (e.type === 'stateChanged') {
        s.setMachineState(e.to);
      }
    }
  };

  const stage = usePoseLoop(videoRef, { onFrame, onError: setError });

  const { sessionCount, target, settings, charIndex, sessionStatus } = store;
  const durationSec = sessionDurationSec(store);
  const win = settings.scriptureEnabled ? scripture.windowAt(charIndex, 6) : null;

  return (
    <div className="page camera-page session-page">
      <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
      {settings.debugOverlay && (
        <>
          <canvas ref={canvasRef} className="camera-preview pose-canvas" />
          <pre ref={debugRef} className="debug-readout" />
        </>
      )}

      <div className="session-top">
        <div className="big-count">{sessionCount}</div>
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
        {stage === 'loading' && !error && <div className="hint">模型加载中…</div>}
      </div>

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
      </div>

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

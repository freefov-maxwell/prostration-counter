import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { usePoseLoop } from '../platform/usePoseLoop';
import { LoadProgress } from '../platform/pose';
import { analyzeStandingFrame, SignalExtractor } from '../engine/signals';
import { evaluateCollision, CollisionResult } from '../engine/collision';
import { DEFAULT_THRESHOLDS } from '../engine/thresholds';
import { findLastRep, personalizeThresholds, replayCounts } from '../engine/trial';
import { Baseline, FrameSignals, PoseFrame } from '../engine/types';
import { playVoice, preloadVoices, VoiceKey } from '../platform/feedback';
import { downloadJson, drawPose } from '../platform/overlay';

type Phase = 'position' | 'trial' | 'result';
type PositionKey = 'enter' | 'headOut' | 'feetOut' | 'tooFar' | 'hold';

/** 远距离可读的大字提示（语音同步播报 scripts/voice-lines.json 中的完整句子）。 */
const POSITION_TEXT: Record<PositionKey, string> = {
  enter: '请走入画面',
  headOut: '头部出画\n请后退一步',
  feetOut: '脚部出画\n请后退一步',
  tooFar: '太远了\n请靠近一点',
  hold: '很好\n站直别动',
};

/** 状态稳定这么久才播报，避免识别抖动时连播。 */
const VOICE_SETTLE_MS = 800;
/** 位置问题持续存在时的重复播报间隔（人站得远，可能没听清）。 */
const VOICE_REPEAT_MS = 8000;

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function CalibratePage() {
  const { settings, setBaseline, startRunning, navigate, markTrialCompleted } = useAppStore();
  const debug = !!settings.debugOverlay;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugRef = useRef<HTMLPreElement | null>(null);
  const [phase, setPhase] = useState<Phase>('position');
  const [posKey, setPosKey] = useState<PositionKey>('enter');
  const [trialRetry, setTrialRetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CollisionResult | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const phaseRef = useRef<Phase>('position');
  phaseRef.current = phase;
  const stableSinceRef = useRef<number | null>(null);
  const samplesRef = useRef<{ H: number; hipY: number; noseY: number; eye: number }[]>([]);
  const baselineRef = useRef<Baseline | null>(null);
  const extractorRef = useRef<SignalExtractor | null>(null);
  const trialSamplesRef = useRef<FrameSignals[]>([]);
  const voiceRef = useRef({ key: null as VoiceKey | null, since: 0, spoken: null as VoiceKey | null, at: 0 });

  const canSkipTrial = settings.completedTrialAt != null;

  useEffect(() => {
    preloadVoices(['enter', 'headOut', 'feetOut', 'tooFar', 'hold', 'trial', 'retry', 'safe', 'close', 'tooClose', 'wrongDirection']);
  }, []);

  const speak = (key: VoiceKey, t: number) => {
    voiceRef.current = { key, since: t, spoken: key, at: t };
    if (useAppStore.getState().settings.soundOn) playVoice(key);
  };

  /** 持续性提示：稳定后播一次，问题未解决则定期重复。 */
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

  const beginTrial = (baseline: Baseline) => {
    baselineRef.current = baseline;
    setBaseline(baseline);
    extractorRef.current = new SignalExtractor(baseline);
    trialSamplesRef.current = [];
    setTrialRetry(false);
    setResult(null);
    setPhase('trial');
    speak('trial', performance.now());
  };

  const onFrame = (frame: PoseFrame, t: number) => {
    const th = DEFAULT_THRESHOLDS;
    const video = videoRef.current;

    if (phaseRef.current === 'position') {
      const a = analyzeStandingFrame(frame);
      let key: PositionKey;
      if (!a.hasPerson) key = 'enter';
      else if (a.headOutTop) key = 'headOut';
      // 脚踝/髋不可见也按脚部出画处理（多为画面下缘裁掉或被遮挡）
      else if (a.feetOutBottom || a.height == null || a.hipY == null) key = 'feetOut';
      else if (a.height < th.targetHeightMin) key = 'tooFar';
      else key = 'hold';
      setPosKey(key);
      guide(key, t);
      if (canvasRef.current && video) drawPose(canvasRef.current, video, frame, key === 'hold', th.inFrameMargin);
      if (debugRef.current)
        debugRef.current.textContent = `H=${a.height?.toFixed(3)} nose=${a.noseY?.toFixed(3)} ankle=${a.ankleY?.toFixed(3)}`;

      if (key === 'hold' && a.height != null && a.hipY != null && a.noseY != null) {
        stableSinceRef.current ??= t;
        samplesRef.current.push({ H: a.height, hipY: a.hipY, noseY: a.noseY, eye: a.eyeDist ?? 0 });
        if (t - stableSinceRef.current >= th.calibrationHoldMs) {
          const ss = samplesRef.current;
          beginTrial({
            H: median(ss.map((s) => s.H)),
            hipY0: median(ss.map((s) => s.hipY)),
            noseY0: median(ss.map((s) => s.noseY)),
            eyeDist0: median(ss.map((s) => s.eye)),
          });
        }
      } else {
        stableSinceRef.current = null;
        samplesRef.current = [];
      }
      return;
    }

    if (canvasRef.current && video) drawPose(canvasRef.current, video, frame, null, th.inFrameMargin);
    if (phaseRef.current !== 'trial' || !extractorRef.current) return;

    const sig = extractorRef.current.update(frame, t);
    const samples = trialSamplesRef.current;
    samples.push(sig);
    // shortcut: 只保留最近约 1.5 分钟的帧，单次试拜远短于此
    if (samples.length > 3000) samples.splice(0, 1000);
    if (debugRef.current)
      debugRef.current.textContent =
        `q=${sig.quality} head=${sig.headDrop?.toFixed(2)} hip=${sig.hipDrop?.toFixed(2)} ` +
        `torso=${sig.torsoAngle?.toFixed(0)} close=${sig.closeness} hand=${sig.handMaxY?.toFixed(2)} n=${samples.length}`;

    // 只在站立帧上分析：findLastRep 要求起身后已站稳
    if (sig.headDrop == null || sig.headDrop >= 0.15) return;
    const rep = findLastRep(samples);
    if (!rep) return;
    if (replayCounts(rep.samples, personalizeThresholds(rep.peakHeadDrop)) < 1) {
      // 分段找到了但状态机数不到（多为起身后髋部不可见）：清空重录，用户无需走回手机
      trialSamplesRef.current = [];
      setTrialRetry(true);
      speak('retry', t);
      return;
    }
    const res = evaluateCollision(rep.samples);
    void markTrialCompleted(rep.peakHeadDrop);
    setResult(res);
    setPhase('result');
    speak(res.verdict, t);
  };

  const stage = usePoseLoop(videoRef, { onFrame, onError: setError, onProgress: setProgress }, retryKey);

  // 重新试拜前用户多半挪过手机，站姿基准需重采
  const retryTrial = () => {
    stableSinceRef.current = null;
    samplesRef.current = [];
    setResult(null);
    setPhase('position');
  };

  const exportTrial = () =>
    downloadJson(
      `dalibai-trial-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      JSON.stringify({ baseline: baselineRef.current, samples: trialSamplesRef.current }),
    );

  return (
    <div className="page camera-page">
      <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="camera-preview pose-canvas" />
      {debug && <pre ref={debugRef} className="debug-readout" />}
      <div className="camera-overlay">
        <header className="page-header overlay-header">
          <button className="btn-text" onClick={() => navigate('prepare')}>
            ‹ 取消
          </button>
          <h2>校准</h2>
          <span />
        </header>

        {!error && stage === 'ready' && phase === 'position' && (
          <div className={`guide-big ${posKey === 'hold' ? 'tone-ok' : 'tone-warn'}`}>{POSITION_TEXT[posKey]}</div>
        )}
        {!error && stage === 'ready' && phase === 'trial' && (
          <div className="guide-big tone-ok">{trialRetry ? '没识别到\n请再拜一次' : '请做一次\n完整大礼拜'}</div>
        )}

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
              <button className="btn-secondary" onClick={() => navigate('home')}>
                返回首页
              </button>
            </div>
          </div>
        )}

        {!error && stage === 'loading' && (
          <div className="panel">
            <p className="guidance">
              首次使用需下载识别资源（约 16 MB），之后离线可用
            </p>
            {progress ? (
              <>
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{
                      width:
                        progress.total > 0
                          ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                          : '100%',
                    }}
                  />
                </div>
                <p className="hint">
                  {(progress.loaded / 1048576).toFixed(1)}
                  {progress.total > 0 && ` / ${(progress.total / 1048576).toFixed(1)}`} MB
                </p>
              </>
            ) : (
              <p className="hint">正在准备…</p>
            )}
          </div>
        )}

        {!error && stage === 'ready' && phase === 'position' && (
          <div className="panel">
            <p className="hint">
              摆放建议：手机立于地面略向后仰，放在趴下后头顶前方约 30–50cm、手臂前伸碰不到的位置。
              全身站进虚线框内，框变绿后保持 2 秒。
            </p>
          </div>
        )}

        {!error && stage === 'ready' && phase === 'trial' && (
          <div className="panel">
            <p className="hint">做完起身站稳约 1 秒，会自动识别并播报结果（试拜不计数）</p>
            <div className="btn-row">
              {canSkipTrial && (
                <button className="btn-secondary" onClick={startRunning}>
                  跳过试拜，直接开始
                </button>
              )}
              {debug && (
                <button className="btn-secondary" onClick={exportTrial}>
                  导出试拜数据
                </button>
              )}
            </div>
          </div>
        )}

        {!error && phase === 'result' && result && (
          <>
            <div className={`guide-big ${result.verdict === 'safe' || result.verdict === 'close' ? 'tone-ok' : 'tone-warn'}`}>
              {result.verdict === 'safe' || result.verdict === 'close' ? '已记录' : '请调整手机'}
            </div>
            <div className="panel">
              {result.verdict === 'safe' && <p className="guidance">试拜完成，手机位置合适。</p>}
              {result.verdict === 'close' && (
                <p className="guidance">
                  位置偏近：建议把手机往前挪约 {result.marginCm ?? 10} 厘米，运动中请注意不要碰倒手机。
                </p>
              )}
              {result.verdict === 'tooClose' && (
                <p className="guidance">
                  位置过近：趴下时手会碰到手机，请将手机前挪后重新试拜。
                </p>
              )}
              {result.verdict === 'wrongDirection' && (
                <p className="guidance">
                  手机摆放方向有误：请把手机放到趴下时头顶的前方，然后重新试拜。
                </p>
              )}
              <div className="btn-row">
                {(result.verdict === 'safe' || result.verdict === 'close') && (
                  <button className="btn-primary" onClick={startRunning}>
                    开始运动
                  </button>
                )}
                <button className="btn-secondary" onClick={retryTrial}>
                  重新试拜
                </button>
                {debug && (
                  <button className="btn-secondary" onClick={exportTrial}>
                    导出试拜数据
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

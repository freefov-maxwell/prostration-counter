import { useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { usePoseLoop } from '../platform/usePoseLoop';
import { LoadProgress } from '../platform/pose';
import { analyzeStandingFrame, SignalExtractor } from '../engine/signals';
import { initialMachineState, MachineState, stepMachine } from '../engine/stateMachine';
import { evaluateCollision, CollisionResult, TrialSample } from '../engine/collision';
import { DEFAULT_THRESHOLDS } from '../engine/thresholds';
import { Baseline } from '../engine/types';

type Phase = 'position' | 'trial' | 'result';

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function CalibratePage() {
  const { settings, setBaseline, startRunning, navigate, markTrialCompleted } = useAppStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<Phase>('position');
  const [guidance, setGuidance] = useState('请走入画面，全身入镜站好');
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
  const machineRef = useRef<MachineState>(initialMachineState());
  const trialSamplesRef = useRef<TrialSample[]>([]);

  const canSkipTrial = settings.completedTrialAt != null;

  const beginTrial = (baseline: Baseline) => {
    baselineRef.current = baseline;
    setBaseline(baseline);
    extractorRef.current = new SignalExtractor(baseline);
    machineRef.current = initialMachineState(performance.now());
    trialSamplesRef.current = [];
    setPhase('trial');
  };

  const onFrame = (frame: import('../engine/types').PoseFrame, t: number) => {
    if (phaseRef.current === 'position') {
      const a = analyzeStandingFrame(frame);
      const th = DEFAULT_THRESHOLDS;
      let ok = false;
      if (!a.hasPerson) {
        setGuidance('请走入画面');
      } else if (a.headOutTop) {
        setGuidance('请将手机后仰一点，或后退一步');
      } else if (a.feetOutBottom) {
        setGuidance('脚部越界，请调整手机角度或后退一步');
      } else if (a.height != null && a.height > th.targetHeightMax) {
        setGuidance('距离过近，请后退');
      } else if (a.height != null && a.height < th.targetHeightMin) {
        setGuidance('距离过远，请靠近一点');
      } else if (a.height != null && a.hipY != null && a.noseY != null) {
        ok = true;
        setGuidance('保持不动，正在记录站姿基准…');
      }

      if (ok && a.height != null && a.hipY != null && a.noseY != null) {
        stableSinceRef.current ??= t;
        samplesRef.current.push({
          H: a.height,
          hipY: a.hipY,
          noseY: a.noseY,
          eye: a.eyeDist ?? 0,
        });
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

    if (phaseRef.current === 'trial' && extractorRef.current) {
      const sig = extractorRef.current.update(frame, t);
      trialSamplesRef.current.push({
        handMaxY: sig.handMaxY,
        eyeDistance: sig.eyeDistance,
        noseY: sig.noseY,
      });
      const { state, events } = stepMachine(machineRef.current, sig);
      machineRef.current = state;
      if (events.some((e) => e.type === 'repCompleted')) {
        void markTrialCompleted();
        setResult(evaluateCollision(trialSamplesRef.current));
        setPhase('result');
      }
    }
  };

  const stage = usePoseLoop(videoRef, { onFrame, onError: setError, onProgress: setProgress }, retryKey);

  const retryTrial = () => {
    if (baselineRef.current) {
      extractorRef.current = new SignalExtractor(baselineRef.current);
      machineRef.current = initialMachineState(performance.now());
      trialSamplesRef.current = [];
      setResult(null);
      setPhase('trial');
    }
  };

  return (
    <div className="page camera-page">
      <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
      <div className="camera-overlay">
        <header className="page-header overlay-header">
          <button className="btn-text" onClick={() => navigate('prepare')}>
            ‹ 取消
          </button>
          <h2>校准</h2>
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
              <button className="btn-secondary" onClick={() => navigate('home')}>
                返回首页
              </button>
            </div>
          </div>
        )}

        {!error && stage === 'loading' && (
          <div className="panel">
            <p className="guidance">
              首次使用需下载{progress ? progress.label : '识别资源'}，之后离线可用
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
            <p className="guidance">{guidance}</p>
            <p className="hint">
              摆放建议：手机立于地面略向后仰，放在趴下后头顶前方约 30–50cm、手臂前伸碰不到的位置
            </p>
          </div>
        )}

        {!error && stage === 'ready' && phase === 'trial' && (
          <div className="panel">
            <p className="guidance">站姿已就绪。请做一次完整的大礼拜（试拜不计数）</p>
            <div className="btn-row">
              {canSkipTrial && (
                <button className="btn-secondary" onClick={startRunning}>
                  跳过试拜，直接开始
                </button>
              )}
            </div>
          </div>
        )}

        {!error && phase === 'result' && result && (
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

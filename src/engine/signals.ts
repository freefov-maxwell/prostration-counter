import {
  Baseline,
  FrameQuality,
  FrameSignals,
  KP,
  Keypoint,
  PoseFrame,
  StandingAnalysis,
} from './types';
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';

function visible(kp: Keypoint | undefined, min: number): kp is Keypoint {
  return !!kp && kp.visibility >= min;
}

function mid(a: Keypoint, b: Keypoint): Keypoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

/** 滑动窗口中值滤波，抑制单帧抖动（窗口 5 帧 ≈ 300ms @15fps）。 */
class MedianFilter {
  private buf: number[] = [];
  constructor(private window: number) {}
  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.window) this.buf.shift();
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/** 眼部关键点 1–4 的最大两两间距（正面视角下近似双眼间距）。 */
function eyeDistance(frame: Keypoint[], minVis: number): number | null {
  const ids = [KP.leftEyeInner, KP.leftEye, KP.leftEyeOuter, KP.rightEyeInner];
  const pts = ids.map((i) => frame[i]).filter((k): k is Keypoint => visible(k, minVis));
  if (pts.length < 2) return null;
  let max = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      max = Math.max(max, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return max;
}

/** 校准页用：分析一帧是否为合格的站姿全身入镜。 */
export function analyzeStandingFrame(
  frame: PoseFrame,
  th: Thresholds = DEFAULT_THRESHOLDS,
): StandingAnalysis {
  const empty: StandingAnalysis = {
    hasPerson: false,
    height: null,
    noseY: null,
    ankleY: null,
    hipY: null,
    eyeDist: null,
    headOutTop: false,
    feetOutBottom: false,
  };
  if (!frame) return empty;
  const nose = frame[KP.nose];
  if (!visible(nose, th.visibilityMin)) return empty;
  const ankles = [frame[KP.leftAnkle], frame[KP.rightAnkle]].filter((k): k is Keypoint =>
    visible(k, th.visibilityMin),
  );
  const hips = [frame[KP.leftHip], frame[KP.rightHip]].filter((k): k is Keypoint =>
    visible(k, th.visibilityMin),
  );
  const ankleY = ankles.length ? ankles.reduce((s, k) => s + k.y, 0) / ankles.length : null;
  const hipY = hips.length ? hips.reduce((s, k) => s + k.y, 0) / hips.length : null;
  const height = ankleY != null ? Math.abs(nose.y - ankleY) : null;
  return {
    hasPerson: true,
    height,
    noseY: nose.y,
    ankleY,
    hipY,
    eyeDist: eyeDistance(frame, th.visibilityMin),
    headOutTop: nose.y <= th.inFrameMargin,
    feetOutBottom: ankleY != null && ankleY >= 1 - th.inFrameMargin,
  };
}

/**
 * 把原始关键点序列转成归一化信号流（技术文档 §4.2）。
 * 所有判定基于校准基准，不做绝对像素判断。
 */
export class SignalExtractor {
  private filters = new Map<string, MedianFilter>();
  private lowVisFrames = 0;
  private lastQuality: FrameQuality = 'LOST';
  private prevFrame: Keypoint[] | null = null;
  /** visibility 低时冻结信号（保持上一有效值）而非置零。 */
  private frozen: Partial<
    Pick<FrameSignals, 'hipDrop' | 'torsoAngle' | 'headDrop' | 'apparentHeight' | 'eyeDistance' | 'torsoDepth'>
  > = {};

  constructor(
    private baseline: Baseline,
    private th: Thresholds = DEFAULT_THRESHOLDS,
  ) {}

  private median(name: string, v: number): number {
    let f = this.filters.get(name);
    if (!f) {
      f = new MedianFilter(this.th.medianWindow);
      this.filters.set(name, f);
    }
    return f.push(v);
  }

  update(frame: PoseFrame, t: number): FrameSignals {
    const th = this.th;
    const motionEnergy = this.computeMotionEnergy(frame);
    this.prevFrame = frame;

    const base: FrameSignals = {
      t,
      quality: 'LOST',
      valid: false,
      hipDrop: this.frozen.hipDrop ?? null,
      torsoAngle: this.frozen.torsoAngle ?? null,
      headDrop: this.frozen.headDrop ?? null,
      apparentHeight: this.frozen.apparentHeight ?? null,
      eyeDistance: this.frozen.eyeDistance ?? null,
      torsoDepth: this.frozen.torsoDepth ?? null,
      motionEnergy,
      closeness: false,
      noseY: null,
      hipY: null,
      handMaxY: null,
    };
    if (!frame) {
      this.lowVisFrames++;
      base.quality = this.debouncedQuality('LOST');
      base.valid = base.quality !== 'LOST';
      return base;
    }

    const nose = frame[KP.nose];
    const lSh = frame[KP.leftShoulder];
    const rSh = frame[KP.rightShoulder];
    const lHip = frame[KP.leftHip];
    const rHip = frame[KP.rightHip];
    const headOk = visible(nose, th.visibilityMin);
    const shouldersOk = visible(lSh, th.visibilityMin) && visible(rSh, th.visibilityMin);
    const hipsOk = visible(lHip, th.visibilityMin) && visible(rHip, th.visibilityMin);

    const rawQuality: FrameQuality =
      headOk && shouldersOk && hipsOk ? 'FULL' : headOk || shouldersOk ? 'PARTIAL' : 'LOST';
    const quality = this.debouncedQuality(rawQuality);
    base.quality = quality;
    base.valid = quality !== 'LOST';

    if (rawQuality === 'LOST') return base;

    // —— 原始终值 ——
    if (headOk) {
      base.noseY = nose.y;
      const headDrop = (nose.y - this.baseline.noseY0) / this.baseline.H;
      base.headDrop = this.median('headDrop', headDrop);
    }
    const eyeDist = eyeDistance(frame, th.visibilityMin);
    if (eyeDist != null) base.eyeDistance = this.median('eyeDistance', eyeDist);

    if (shouldersOk && hipsOk) {
      const shoulderMid = mid(lSh, rSh);
      const hipMid = mid(lHip, rHip);
      base.hipY = hipMid.y;
      base.hipDrop = this.median('hipDrop', (hipMid.y - this.baseline.hipY0) / this.baseline.H);
      const dx = shoulderMid.x - hipMid.x;
      const dy = shoulderMid.y - hipMid.y;
      const angle = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
      base.torsoAngle = this.median('torsoAngle', angle);
      if (headOk) base.torsoDepth = nose.z - hipMid.z;
    }

    const ankles = [frame[KP.leftAnkle], frame[KP.rightAnkle]].filter((k): k is Keypoint =>
      visible(k, th.visibilityMin),
    );
    if (headOk && ankles.length) {
      const ankleY = ankles.reduce((s, k) => s + k.y, 0) / ankles.length;
      base.apparentHeight = this.median('apparentHeight', Math.abs(nose.y - ankleY) / this.baseline.H);
    }

    // 手部最低点（y 向下，越接近 1 越贴近手机）
    const handYs = [KP.leftWrist, KP.rightWrist, KP.leftIndex, KP.rightIndex]
      .map((i) => frame[i])
      .filter((k): k is Keypoint => visible(k, th.visibilityMin))
      .map((k) => k.y);
    if (handYs.length) base.handMaxY = Math.max(...handYs);

    // 贴近特征：眼距突然放大（人脸贴近）或头部从底部出界
    const eyeSurge =
      base.eyeDistance != null &&
      this.baseline.eyeDist0 > 0 &&
      base.eyeDistance > this.baseline.eyeDist0 * th.closenessEyeScale;
    const noseOut = base.noseY != null && base.noseY > th.noseOutBottomY;
    base.closeness = eyeSurge || noseOut;

    // 更新冻结值
    if (quality !== 'LOST') {
      this.frozen = {
        hipDrop: base.hipDrop ?? this.frozen.hipDrop,
        torsoAngle: base.torsoAngle ?? this.frozen.torsoAngle,
        headDrop: base.headDrop ?? this.frozen.headDrop,
        apparentHeight: base.apparentHeight ?? this.frozen.apparentHeight,
        eyeDistance: base.eyeDistance ?? this.frozen.eyeDistance,
        torsoDepth: base.torsoDepth ?? this.frozen.torsoDepth,
      };
    }
    return base;
  }

  /** visibility 突降不立刻判丢失：连续 N 帧低置信才判 LOST。 */
  private debouncedQuality(raw: FrameQuality): FrameQuality {
    if (raw === 'LOST') {
      this.lowVisFrames++;
      if (this.lowVisFrames >= this.th.lostFramesThreshold) this.lastQuality = 'LOST';
    } else {
      this.lowVisFrames = 0;
      this.lastQuality = raw;
    }
    return this.lastQuality;
  }

  /** 低成本运动能量：关键点位置帧差分的均值，映射到 0..1。 */
  private computeMotionEnergy(frame: PoseFrame): number {
    if (!frame || !this.prevFrame) return 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < frame.length && i < this.prevFrame.length; i++) {
      const a = frame[i];
      const b = this.prevFrame[i];
      if (!a || !b) continue;
      sum += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      n++;
    }
    if (!n) return 0;
    return Math.min(1, (sum / n) * 10);
  }
}

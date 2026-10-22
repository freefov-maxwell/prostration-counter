import { Baseline, FrameQuality, FrameSignals, KP, Keypoint, PoseFrame, StandingAnalysis } from './types';
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';

function visible(kp: Keypoint | undefined, min: number): kp is Keypoint {
  return !!kp && kp.visibility >= min;
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

interface Measures {
  noseY: number | null;
  ankleY: number | null;
  /** |nose.y − ankleMid.y|。 */
  height: number | null;
  shoulderW: number | null;
  earW: number | null;
  upright: boolean;
  legsStraight: boolean;
  armsDown: boolean;
  shouldersOk: boolean;
  hipsOk: boolean;
}

/** 单帧原始几何量（不涉及基准）。 */
function measure(frame: Keypoint[], th: Thresholds): Measures {
  const v = (i: number) => (visible(frame[i], th.visibilityMin) ? frame[i] : null);
  const nose = v(KP.nose);
  const lSh = v(KP.leftShoulder);
  const rSh = v(KP.rightShoulder);
  const lHip = v(KP.leftHip);
  const rHip = v(KP.rightHip);
  const lEar = v(KP.leftEar);
  const rEar = v(KP.rightEar);
  const ankles = [v(KP.leftAnkle), v(KP.rightAnkle)].filter((k): k is Keypoint => !!k);
  const ankleY = ankles.length ? ankles.reduce((s, k) => s + k.y, 0) / ankles.length : null;
  const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y);

  let upright = false;
  let legsStraight = false;
  let armsDown = false;
  if (lSh && rSh && lHip && rHip) {
    const dx = (lSh.x + rSh.x - lHip.x - rHip.x) / 2;
    const dy = (lHip.y + rHip.y - lSh.y - rSh.y) / 2; // 髋在肩下方时为正，即躯干长
    upright = dy > 0 && (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI < th.uprightMaxAngle;
    const hipY = (lHip.y + rHip.y) / 2;
    const hipX = (lHip.x + rHip.x) / 2;
    legsStraight = upright && ankleY != null && (ankleY - hipY) / dy >= th.readyLegRatio;
    const lW = v(KP.leftWrist);
    const rW = v(KP.rightWrist);
    const shW = dist(lSh, rSh);
    // 手腕不高于髋上方 1/4 躯干，水平方向不超出身体太多（排除 T 字、举手、叉腰外展）
    const down = (w: Keypoint | null) => !!w && w.y >= hipY - 0.25 * dy && Math.abs(w.x - hipX) <= 1.2 * shW;
    armsDown = upright && down(lW) && down(rW);
  }
  return {
    noseY: nose ? nose.y : null,
    ankleY,
    height: nose && ankleY != null ? Math.abs(nose.y - ankleY) : null,
    shoulderW: lSh && rSh ? dist(lSh, rSh) : null,
    earW: lEar && rEar ? dist(lEar, rEar) : null,
    upright,
    legsStraight,
    armsDown,
    shouldersOk: !!(lSh && rSh),
    hipsOk: !!(lHip && rHip),
  };
}

/** 起始站位用：分析一帧是否为合格的站姿全身入镜。 */
export function analyzeStandingFrame(
  frame: PoseFrame,
  th: Thresholds = DEFAULT_THRESHOLDS,
): StandingAnalysis {
  if (!frame || !visible(frame[KP.nose], th.visibilityMin)) {
    return {
      hasPerson: false,
      height: null,
      noseY: null,
      ankleY: null,
      shoulderW: null,
      earW: null,
      upright: false,
      legsStraight: false,
      armsDown: false,
      headOutTop: false,
      feetOutBottom: false,
    };
  }
  const m = measure(frame, th);
  return {
    hasPerson: true,
    height: m.height,
    noseY: m.noseY,
    ankleY: m.ankleY,
    shoulderW: m.shoulderW,
    earW: m.earW,
    upright: m.upright,
    legsStraight: m.legsStraight,
    armsDown: m.armsDown,
    headOutTop: m.noseY! <= th.inFrameMargin,
    feetOutBottom: m.ankleY != null && m.ankleY >= 1 - th.inFrameMargin,
  };
}

/**
 * 把原始关键点序列转成相对站姿基准的信号流。
 * 远近比（肩宽）与头部下降互相印证：仰头时鼻子可能回到站立高度，但人离镜头很近，不会被当成站直。
 */
export class SignalExtractor {
  private filters = new Map<string, MedianFilter>();
  private lowVisFrames = 0;
  private lastQuality: FrameQuality = 'LOST';
  private lastLowness = 0;
  /** 最近一次滤波后的原始量，rebase 时用。 */
  private recent: Partial<Record<'noseY' | 'height' | 'shoulderW' | 'earW', number>> = {};

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
    const b = this.baseline;
    const out: FrameSignals = {
      t,
      quality: 'LOST',
      valid: false,
      headDrop: null,
      scale: null,
      heightRatio: null,
      upright: false,
      standing: false,
      lowness: this.lastLowness,
    };
    const m = frame ? measure(frame, th) : null;
    const raw: FrameQuality = !m
      ? 'LOST'
      : m.noseY != null && m.shouldersOk && m.hipsOk
        ? 'FULL'
        : m.noseY != null || m.shouldersOk
          ? 'PARTIAL'
          : 'LOST';
    out.quality = this.debouncedQuality(raw);
    out.valid = out.quality !== 'LOST';
    if (!m || raw === 'LOST') return out;

    if (m.noseY != null) {
      this.recent.noseY = this.median('noseY', m.noseY);
      out.headDrop = (this.recent.noseY - b.noseY0) / b.H;
    }
    if (m.height != null) {
      this.recent.height = this.median('height', m.height);
      out.heightRatio = this.recent.height / b.H;
    }
    if (m.shoulderW != null) this.recent.shoulderW = this.median('shoulderW', m.shoulderW);
    if (m.earW != null) this.recent.earW = this.median('earW', m.earW);
    if (m.shoulderW != null && b.shoulderW0 > 0) out.scale = this.recent.shoulderW! / b.shoulderW0;
    else if (m.earW != null && b.earW0 > 0) out.scale = this.recent.earW! / b.earW0;
    out.upright = m.upright;

    const terms: number[] = [];
    if (out.headDrop != null) terms.push(out.headDrop / th.lowHeadDrop);
    if (out.scale != null) terms.push((out.scale - 1) / (th.lowScale - 1));
    if (terms.length) this.lastLowness = Math.max(...terms);
    out.lowness = this.lastLowness;

    out.standing =
      out.upright &&
      out.headDrop != null &&
      Math.abs(out.headDrop) < th.standHeadDrop &&
      out.heightRatio != null &&
      out.heightRatio >= th.standHeightRatio &&
      out.scale != null &&
      out.scale >= th.standScaleMin &&
      out.scale <= th.standScaleMax;
    return out;
  }

  /** 站直确认后调用：基准向最近的站姿测量值靠拢，容忍每拜之间站位前后移动。 */
  rebase(): void {
    const a = this.th.baselineAdapt;
    const b = this.baseline;
    const r = this.recent;
    const mix = (from: number, to: number | undefined) => (to == null || from <= 0 ? from : from + (to - from) * a);
    this.baseline = {
      H: mix(b.H, r.height),
      noseY0: r.noseY == null ? b.noseY0 : b.noseY0 + (r.noseY - b.noseY0) * a,
      shoulderW0: mix(b.shoulderW0, r.shoulderW),
      earW0: mix(b.earW0, r.earW),
    };
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
}

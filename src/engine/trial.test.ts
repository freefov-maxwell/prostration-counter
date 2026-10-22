import { describe, expect, it } from 'vitest';
import { findLastRep, personalizeThresholds, replayCounts } from './trial';
import { FrameSignals } from './types';
import { DEFAULT_THRESHOLDS } from './thresholds';

const DT = 60;

function makeSig(t: number, over: Partial<FrameSignals> = {}): FrameSignals {
  return {
    t,
    quality: 'FULL',
    valid: true,
    hipDrop: 0,
    torsoAngle: 0,
    headDrop: 0,
    apparentHeight: 1,
    eyeDistance: 0.02,
    torsoDepth: 0,
    motionEnergy: 0.5,
    closeness: false,
    noseY: 0.3,
    hipY: 0.5,
    handMaxY: 0.6,
    ...over,
  };
}

class Rec {
  out: FrameSignals[] = [];
  t = 0;
  feed(ms: number, over: Partial<FrameSignals> = {}) {
    for (let i = 0; i < ms / DT; i++) this.out.push(makeSig((this.t += DT), over));
    return this;
  }
}

/** 正面地面摆放的典型试拜：俯地时脸朝下，看不到贴近特征（closeness 恒 false）。 */
function frontRep(r: Rec, peak = 0.8) {
  r.feed(600, { headDrop: peak * 0.4, hipDrop: 0.3 });
  r.feed(2000, { headDrop: peak, hipDrop: 0.5, quality: 'PARTIAL' });
  r.feed(600, { headDrop: peak * 0.4, hipDrop: 0.3 });
}

describe('findLastRep 试拜分段', () => {
  it('站 → 俯地 → 站稳 1s：找到一次，深度取实测', () => {
    const r = new Rec().feed(1000);
    frontRep(r);
    r.feed(1200);
    const rep = findLastRep(r.out);
    expect(rep).not.toBeNull();
    expect(rep!.peakHeadDrop).toBeCloseTo(0.8);
  });

  it('起身后还没站稳 1s：暂不判定', () => {
    const r = new Rec().feed(1000);
    frontRep(r);
    r.feed(500);
    expect(findLastRep(r.out)).toBeNull();
  });

  it('只是弯腰（深度 < 0.3）：不算', () => {
    const r = new Rec().feed(1000);
    frontRep(r, 0.25);
    r.feed(1200);
    expect(findLastRep(r.out)).toBeNull();
  });

  it('俯地中单帧抖回"站立"不会把一次切成两段', () => {
    const r = new Rec().feed(1000);
    r.feed(600, { headDrop: 0.3 });
    r.feed(1000, { headDrop: 0.8, quality: 'PARTIAL' });
    r.feed(DT, { headDrop: 0.05 });
    r.feed(1000, { headDrop: 0.8, quality: 'PARTIAL' });
    r.feed(600, { headDrop: 0.3 });
    r.feed(1200);
    expect(findLastRep(r.out)).not.toBeNull();
  });

  it('多次试拜取最后一次', () => {
    const r = new Rec().feed(1000);
    frontRep(r, 0.6);
    r.feed(1200);
    frontRep(r, 0.9);
    r.feed(1200);
    expect(findLastRep(r.out)!.peakHeadDrop).toBeCloseTo(0.9);
  });
});

describe('个性化阈值 + 回放自检', () => {
  it('默认阈值要求贴近特征，正面脸朝下数不到；个性化后能数到 1 次', () => {
    const r = new Rec().feed(1000);
    frontRep(r);
    r.feed(1200);
    const rep = findLastRep(r.out)!;
    expect(replayCounts(rep.samples, DEFAULT_THRESHOLDS)).toBe(0);
    expect(replayCounts(rep.samples, personalizeThresholds(rep.peakHeadDrop))).toBe(1);
  });
});

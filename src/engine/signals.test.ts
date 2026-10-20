import { describe, expect, it } from 'vitest';
import { SignalExtractor, analyzeStandingFrame } from './signals';
import { Baseline, KP, Keypoint } from './types';

const baseline: Baseline = { H: 0.8, hipY0: 0.5, noseY0: 0.1, eyeDist0: 0.02 };

function kp(x: number, y: number, visibility = 0.9): Keypoint {
  return { x, y, z: 0, visibility };
}

/** 构造 33 关键点的站姿帧：nose 0.1 / 肩 0.25 / 髋 0.5 / 踝 0.9 → H=0.8 */
function standingFrame(over: Partial<Record<number, Keypoint>> = {}): Keypoint[] {
  const frame: Keypoint[] = Array.from({ length: 33 }, () => kp(0.5, 0.5, 0.9));
  frame[KP.nose] = kp(0.5, 0.1);
  frame[KP.leftShoulder] = kp(0.4, 0.25);
  frame[KP.rightShoulder] = kp(0.6, 0.25);
  frame[KP.leftHip] = kp(0.45, 0.5);
  frame[KP.rightHip] = kp(0.55, 0.5);
  frame[KP.leftAnkle] = kp(0.45, 0.9);
  frame[KP.rightAnkle] = kp(0.55, 0.9);
  frame[KP.leftEyeInner] = kp(0.49, 0.09);
  frame[KP.rightEyeInner] = kp(0.51, 0.09);
  for (const [i, v] of Object.entries(over)) if (v) frame[Number(i)] = v;
  return frame;
}

describe('SignalExtractor 归一化与滤波', () => {
  it('站姿帧：hipDrop/torsoAngle 约为 0，帧质量 FULL', () => {
    const ex = new SignalExtractor(baseline);
    const sig = ex.update(standingFrame(), 0);
    expect(sig.quality).toBe('FULL');
    expect(sig.valid).toBe(true);
    expect(sig.hipDrop!).toBeCloseTo(0, 5);
    expect(sig.torsoAngle!).toBeCloseTo(0, 1);
    expect(sig.headDrop!).toBeCloseTo(0, 5);
    expect(sig.apparentHeight!).toBeCloseTo(1, 5);
  });

  it('髋部下移归一化为 hipDrop（相对基准 H）', () => {
    const ex = new SignalExtractor(baseline);
    // 髋部 0.5 → 0.9：hipDrop = (0.9−0.5)/0.8 = 0.5，连续多帧让中值滤波收敛
    let last = ex.update(standingFrame(), 0);
    for (let i = 1; i <= 6; i++) {
      last = ex.update(
        standingFrame({ [KP.leftHip]: kp(0.45, 0.9), [KP.rightHip]: kp(0.55, 0.9) }),
        i * 60,
      );
    }
    expect(last.hipDrop!).toBeCloseTo(0.5, 5);
  });

  it('中值滤波抑制单帧抖动', () => {
    const ex = new SignalExtractor(baseline);
    for (let i = 0; i < 4; i++) ex.update(standingFrame(), i * 60);
    // 单帧髋部异常
    const spike = ex.update(
      standingFrame({ [KP.leftHip]: kp(0.45, 0.95), [KP.rightHip]: kp(0.55, 0.95) }),
      300,
    );
    expect(spike.hipDrop!).toBeCloseTo(0, 5);
  });

  it('帧质量分级：髋不可见 → PARTIAL；连续 3 帧无效 → LOST（滞回防抖）', () => {
    const ex = new SignalExtractor(baseline);
    ex.update(standingFrame(), 0);

    const noHips = standingFrame({
      [KP.leftHip]: kp(0.45, 0.5, 0.1),
      [KP.rightHip]: kp(0.55, 0.5, 0.1),
    });
    expect(ex.update(noHips, 60).quality).toBe('PARTIAL');

    const empty: Keypoint[] = Array.from({ length: 33 }, () => kp(0.5, 0.5, 0.1));
    // 前 2 帧仍保持上一次质量（防抖），第 3 帧才判 LOST
    expect(ex.update(empty, 120).quality).not.toBe('LOST');
    expect(ex.update(empty, 180).quality).not.toBe('LOST');
    const lost = ex.update(empty, 240);
    expect(lost.quality).toBe('LOST');
    expect(lost.valid).toBe(false);
  });

  it('贴近特征：眼距突然放大 → closeness', () => {
    const ex = new SignalExtractor(baseline);
    for (let i = 0; i < 5; i++) ex.update(standingFrame(), i * 60);
    const close = standingFrame({
      [KP.leftEyeInner]: kp(0.4, 0.09),
      [KP.rightEyeInner]: kp(0.6, 0.09),
    });
    let sig = ex.update(close, 360);
    for (let i = 0; i < 4; i++) sig = ex.update(close, 420 + i * 60);
    expect(sig.closeness).toBe(true);
  });
});

describe('analyzeStandingFrame（校准站姿分析）', () => {
  it('正常站姿：高度 0.8，无越界', () => {
    const a = analyzeStandingFrame(standingFrame());
    expect(a.hasPerson).toBe(true);
    expect(a.height!).toBeCloseTo(0.8, 5);
    expect(a.headOutTop).toBe(false);
    expect(a.feetOutBottom).toBe(false);
  });

  it('头部越界 / 无人', () => {
    expect(analyzeStandingFrame(standingFrame({ [KP.nose]: kp(0.5, 0.02) })).headOutTop).toBe(true);
    expect(analyzeStandingFrame(null).hasPerson).toBe(false);
  });
});

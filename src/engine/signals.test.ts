import { describe, expect, it } from 'vitest';
import { SignalExtractor, analyzeStandingFrame } from './signals';
import { Baseline, FrameSignals, KP, Keypoint } from './types';

/** 站姿：鼻 0.1 / 肩 0.25（宽 0.2）/ 髋 0.5 / 踝 0.9 → H = 0.8 */
const baseline: Baseline = { H: 0.8, noseY0: 0.1, shoulderW0: 0.2, earW0: 0.06 };

function kp(x: number, y: number, visibility = 0.9): Keypoint {
  return { x, y, z: 0, visibility };
}

function standingFrame(over: Partial<Record<number, Keypoint>> = {}): Keypoint[] {
  const frame: Keypoint[] = Array.from({ length: 33 }, () => kp(0.5, 0.5, 0.1));
  frame[KP.nose] = kp(0.5, 0.1);
  frame[KP.leftEar] = kp(0.47, 0.09);
  frame[KP.rightEar] = kp(0.53, 0.09);
  frame[KP.leftShoulder] = kp(0.4, 0.25);
  frame[KP.rightShoulder] = kp(0.6, 0.25);
  frame[KP.leftHip] = kp(0.45, 0.5);
  frame[KP.rightHip] = kp(0.55, 0.5);
  frame[KP.leftAnkle] = kp(0.45, 0.9);
  frame[KP.rightAnkle] = kp(0.55, 0.9);
  frame[KP.leftWrist] = kp(0.38, 0.52); // 双手自然下垂在髋旁
  frame[KP.rightWrist] = kp(0.62, 0.52);
  for (const [i, v] of Object.entries(over)) if (v) frame[Number(i)] = v;
  return frame;
}

const HIDDEN = (x: number, y: number) => kp(x, y, 0.1);

/** 连续喂同一帧让中值滤波收敛，返回最后一帧信号。 */
function settle(ex: SignalExtractor, frame: Keypoint[], t0 = 0): FrameSignals {
  let sig!: FrameSignals;
  for (let i = 0; i < 6; i++) sig = ex.update(frame, t0 + i * 60);
  return sig;
}

describe('SignalExtractor 多信号姿态判定', () => {
  it('reanchor：人往前站近后重取基准，站直恢复成立；肩宽按身高比例缩放', () => {
    const ex = new SignalExtractor(baseline);
    // 整体放大 1.4 倍（站近），以画面中心为原点
    const z = (k: Keypoint) => kp(0.5 + (k.x - 0.5) * 1.4, 0.5 + (k.y - 0.5) * 1.4);
    const near = standingFrame().map(z);
    const before = settle(ex, near);
    expect(before.stance).toBe(true);
    expect(before.standing).toBe(false);
    ex.reanchor();
    const after = settle(ex, near, 1000);
    expect(after.standing).toBe(true);
    expect(after.scale).toBeCloseTo(1, 2);
    expect(ex.getBaseline().shoulderW0).toBeCloseTo(0.28, 3);
  });

  it('站姿：站直，远近比 ≈ 1，lowness ≈ 0', () => {
    const sig = settle(new SignalExtractor(baseline), standingFrame());
    expect(sig.quality).toBe('FULL');
    expect(sig.standing).toBe(true);
    expect(sig.scale!).toBeCloseTo(1, 5);
    expect(sig.headDrop!).toBeCloseTo(0, 5);
    expect(sig.lowness).toBeCloseTo(0, 5);
  });

  it('撑地仰头：鼻子回到站立高度，但人离镜头很近 → 不是站直，仍是低位', () => {
    // 肩宽 3 倍（离镜头近），鼻子在站立高度，脚看不到
    const cobra = standingFrame({
      [KP.leftShoulder]: kp(0.2, 0.3),
      [KP.rightShoulder]: kp(0.8, 0.3),
      [KP.leftHip]: HIDDEN(0.45, 0.6),
      [KP.rightHip]: HIDDEN(0.55, 0.6),
      [KP.leftAnkle]: HIDDEN(0.45, 0.9),
      [KP.rightAnkle]: HIDDEN(0.55, 0.9),
    });
    const sig = settle(new SignalExtractor(baseline), cobra);
    expect(sig.headDrop!).toBeCloseTo(0, 5);
    expect(sig.standing).toBe(false);
    expect(sig.lowness).toBeGreaterThanOrEqual(1);
  });

  it('脸朝下看不到鼻子：靠肩宽判断低位', () => {
    const faceDown = standingFrame({
      [KP.nose]: HIDDEN(0.5, 0.6),
      [KP.leftShoulder]: kp(0.3, 0.6),
      [KP.rightShoulder]: kp(0.7, 0.6),
    });
    const sig = settle(new SignalExtractor(baseline), faceDown);
    expect(sig.headDrop).toBeNull();
    expect(sig.lowness).toBeGreaterThanOrEqual(1);
  });

  it('原地深蹲：头降很多、身高变矮，但人没靠近镜头 → 不是站直，也不算低位', () => {
    // 鼻子降 0.45/0.8 ≈ 0.56H（超过头部下降阈值），肩宽不变
    const squat = standingFrame({ [KP.nose]: kp(0.5, 0.55), [KP.leftShoulder]: kp(0.4, 0.65), [KP.rightShoulder]: kp(0.6, 0.65) });
    const sig = settle(new SignalExtractor(baseline), squat);
    expect(sig.headDrop!).toBeGreaterThan(0.45);
    expect(sig.standing).toBe(false);
    expect(sig.lowness).toBeLessThan(0.3); // 连下拜趋势都不触发
  });

  it('扑向镜头途中：远近比 ≥ 1.25 后头部下降开始计入低位', () => {
    const lean = standingFrame({ [KP.nose]: kp(0.5, 0.5), [KP.leftShoulder]: kp(0.35, 0.6), [KP.rightShoulder]: kp(0.65, 0.6) });
    const sig = settle(new SignalExtractor(baseline), lean); // 远近比 1.5，头降 0.5H
    expect(sig.lowness).toBeGreaterThanOrEqual(1);
  });

  it('人丢失时 lowness 保持上一有效值', () => {
    const ex = new SignalExtractor(baseline);
    const low = settle(ex, standingFrame({ [KP.nose]: kp(0.5, 0.6) }));
    let lost!: FrameSignals;
    for (let i = 0; i < 4; i++) lost = ex.update(null, 1000 + i * 60);
    expect(lost.valid).toBe(false);
    expect(lost.lowness).toBeCloseTo(low.lowness, 5);
  });

  it('rebase：站位前移后基准逐步跟上', () => {
    const ex = new SignalExtractor(baseline);
    // 人往前站了一点：肩宽 ×1.2，身高 ×1.2
    const closer = standingFrame({
      [KP.nose]: kp(0.5, 0.06),
      [KP.leftShoulder]: kp(0.38, 0.2),
      [KP.rightShoulder]: kp(0.62, 0.2),
      [KP.leftAnkle]: kp(0.45, 1.02 - 0.06),
      [KP.rightAnkle]: kp(0.55, 1.02 - 0.06),
    });
    const before = settle(ex, closer);
    for (let i = 0; i < 10; i++) ex.rebase();
    const after = settle(ex, closer, 1000);
    expect(Math.abs(after.scale! - 1)).toBeLessThan(Math.abs(before.scale! - 1));
    expect(after.scale!).toBeCloseTo(1, 1);
  });

  it('帧质量分级：髋不可见 → PARTIAL；连续 3 帧无效 → LOST（滞回防抖）', () => {
    const ex = new SignalExtractor(baseline);
    ex.update(standingFrame(), 0);
    const noHips = standingFrame({ [KP.leftHip]: HIDDEN(0.45, 0.5), [KP.rightHip]: HIDDEN(0.55, 0.5) });
    expect(ex.update(noHips, 60).quality).toBe('PARTIAL');
    expect(ex.update(null, 120).quality).not.toBe('LOST');
    expect(ex.update(null, 180).quality).not.toBe('LOST');
    expect(ex.update(null, 240).quality).toBe('LOST');
  });
});

describe('analyzeStandingFrame（起始站位分析）', () => {
  it('正常站姿：高度 0.8、直立、肩宽可测，无越界', () => {
    const a = analyzeStandingFrame(standingFrame());
    expect(a.hasPerson).toBe(true);
    expect(a.height!).toBeCloseTo(0.8, 5);
    expect(a.upright).toBe(true);
    expect(a.shoulderW!).toBeCloseTo(0.2, 5);
    expect(a.headOutTop).toBe(false);
    expect(a.feetOutBottom).toBe(false);
  });

  it('头部越界 / 无人', () => {
    expect(analyzeStandingFrame(standingFrame({ [KP.nose]: kp(0.5, 0.02) })).headOutTop).toBe(true);
    expect(analyzeStandingFrame(null).hasPerson).toBe(false);
  });

  it('预备姿势：站直、双手下垂 → 腿直、手垂都成立', () => {
    const a = analyzeStandingFrame(standingFrame());
    expect(a.legsStraight).toBe(true);
    expect(a.armsDown).toBe(true);
  });

  it('蹲在镜头前：头脚都在画面内、躯干直立，但腿被压短 → 不算预备姿势', () => {
    // 肩 0.3 / 髋 0.55 / 踝 0.85：腿长/躯干 = 0.30/0.25 = 1.2 < 1.3
    const squat = standingFrame({
      [KP.nose]: kp(0.5, 0.15),
      [KP.leftShoulder]: kp(0.35, 0.3),
      [KP.rightShoulder]: kp(0.65, 0.3),
      [KP.leftHip]: kp(0.42, 0.55),
      [KP.rightHip]: kp(0.58, 0.55),
      [KP.leftWrist]: kp(0.4, 0.6),
      [KP.rightWrist]: kp(0.6, 0.6),
      [KP.leftAnkle]: kp(0.42, 0.85),
      [KP.rightAnkle]: kp(0.58, 0.85),
    });
    const a = analyzeStandingFrame(squat);
    expect(a.upright).toBe(true);
    expect(a.feetOutBottom).toBe(false);
    expect(a.legsStraight).toBe(false);
  });

  it('T 字 / 举手：双手不算下垂', () => {
    const tPose = standingFrame({ [KP.leftWrist]: kp(0.1, 0.25), [KP.rightWrist]: kp(0.9, 0.25) });
    expect(analyzeStandingFrame(tPose).armsDown).toBe(false);
    const oneHandUp = standingFrame({ [KP.rightWrist]: kp(0.62, 0.05) });
    expect(analyzeStandingFrame(oneHandUp).armsDown).toBe(false);
  });
});

// 试拜分析：从试拜录制的信号流里找出最后一次完整大礼拜（站 → 俯地 → 站），
// 用实测俯地深度生成个性化阈值，并回放状态机自检。纯函数，可单测。
import { FrameSignals } from './types';
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';
import { initialMachineState, stepMachine } from './stateMachine';

/** headDrop 低于此视为站立。 */
const STAND_HEAD_DROP = 0.15;
/** 短于此的"站立"片段视为识别抖动，并入下拜段。 */
const MIN_STAND_MS = 300;
/** 起身后站稳多久才分析（也是自动判定"做完了"的等待时间）。 */
const END_STAND_MS = 1000;
const MIN_DOWN_MS = 1500;
const MAX_DOWN_MS = 30000;
/** 俯地深度下限：浅于此视为弯腰，不算大礼拜。 */
const MIN_PEAK = 0.3;

export interface RepWindow {
  /** 该次大礼拜（含前后站立段）的信号切片。 */
  samples: FrameSignals[];
  /** 俯地段 headDrop 的 90 分位，即该用户在当前摆放下的俯地深度。 */
  peakHeadDrop: number;
}

const isStand = (s: FrameSignals) => s.valid && s.headDrop != null && s.headDrop < STAND_HEAD_DROP;

export function findLastRep(samples: FrameSignals[]): RepWindow | null {
  const runs: { stand: boolean; from: number; to: number }[] = [];
  samples.forEach((s, i) => {
    const stand = isStand(s);
    const last = runs[runs.length - 1];
    if (last && last.stand === stand) last.to = i;
    else runs.push({ stand, from: i, to: i });
  });
  const dur = (r: { from: number; to: number }) => samples[r.to].t - samples[r.from].t;
  // 过短的站立片段并入相邻下拜段
  const merged: typeof runs = [];
  for (const r of runs) {
    const stand = r.stand && dur(r) >= MIN_STAND_MS;
    const last = merged[merged.length - 1];
    if (last && last.stand === stand) last.to = r.to;
    else merged.push({ stand, from: r.from, to: r.to });
  }
  if (merged.length < 3) return null;
  const [before, down, after] = merged.slice(-3);
  if (!after.stand || dur(after) < END_STAND_MS || !before.stand) return null;
  const downMs = dur(down);
  if (downMs < MIN_DOWN_MS || downMs > MAX_DOWN_MS) return null;
  const drops = samples
    .slice(down.from, down.to + 1)
    .map((s) => s.headDrop)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (!drops.length) return null;
  const peakHeadDrop = drops[Math.floor((drops.length - 1) * 0.9)];
  if (peakHeadDrop < MIN_PEAK) return null;
  return { samples: samples.slice(before.from, after.to + 1), peakHeadDrop };
}

/** 按实测俯地深度缩放正面推断阈值；深度已是实测，不再要求贴近特征。 */
export function personalizeThresholds(peakHeadDrop: number, base: Thresholds = DEFAULT_THRESHOLDS): Thresholds {
  return {
    ...base,
    descendHeadDrop: Math.max(STAND_HEAD_DROP, 0.3 * peakHeadDrop),
    proneHeadDrop: 0.6 * peakHeadDrop,
    riseHeadDropHysteresis: 0.25 * peakHeadDrop,
    proneRequiresCloseness: false,
  };
}

/** 回放自检：用个性化阈值跑一遍状态机，确认这次试拜能被正式计数。 */
export function replayCounts(samples: FrameSignals[], th: Thresholds): number {
  let state = initialMachineState(samples[0]?.t ?? 0);
  let count = 0;
  for (const s of samples) {
    const r = stepMachine(state, s, th);
    state = r.state;
    count += r.events.filter((e) => e.type === 'repCompleted').length;
  }
  return count;
}

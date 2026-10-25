// 用手机导出的真实调试录制回放引擎（同一人、同一台 iPhone、手机放地面）。
// 录制文件放在 data/（不入库），本地有哪段就回放哪段，CI 上自动跳过。
import { describe, expect, it } from 'vitest';
import { SignalExtractor } from './signals';
import { initialMachineState, stepMachine } from './stateMachine';
import { SubjectTracker } from './subject';
import { Keypoint } from './types';

const files = import.meta.glob<string>('../../data/*.json', { query: '?raw', import: 'default', eager: true });

/** [录制文件时间戳, 实际归元瑜伽次数, 内容] */
const RECORDINGS: [string, number, string][] = [
  ['T05-33-36-465Z', 3, 'movenet：先走近镜头再退回 3 次，再 3 拜'],
  ['T05-38-59-296Z', 3, 'mediapipe：先走近镜头再退回 3 次，再 3 拜'],
  ['T08-09-03-858Z', 9, 'movenet 15fps：正常 3 拜、快拜 3、合掌挡脸起身 2、跪停 5s 后起身 1'],
  ['T08-10-50-501Z', 0, 'movenet 15fps：鞠躬、走到手机前蹲下、坐地、走动'],
  ['T08-12-03-977Z', 3, 'movenet 15fps：拜后不回原位（向前漂移后又退回）'],
  // T08-40-59-758Z / T08-42-11-849Z：叩头（跪拜不扑地）+ 归元瑜伽，叩头目前会被计数，暂不纳入
];

interface RecFrame {
  t: number;
  kp: number[] | null;
  alt?: number[][];
  st?: string;
  sig?: unknown;
}

const unflat = (a: number[]): Keypoint[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: a[i * 4], y: a[i * 4 + 1], z: a[i * 4 + 2], visibility: a[i * 4 + 3] }));

/**
 * fps：按 App 的推理限速降采样回放（录制时为 43–60fps，App 现限速 15fps）。
 * MediaPipe 录制与 App 一致，经 SubjectTracker 从全部候选（kp + alt）里挑人；edit 可改写候选（注入旁人）。
 */
function replay(raw: string, fps?: number, edit?: (poses: Keypoint[][], f: RecFrame) => Keypoint[][]): number {
  const d = JSON.parse(raw);
  const ex = new SignalExtractor(d.baseline0);
  const tracker = d.poseModel === 'mediapipe' ? new SubjectTracker() : null;
  let frames: RecFrame[] = d.frames.filter((f: RecFrame) => f.sig); // 只回放计数阶段
  if (fps) {
    let last = -Infinity;
    frames = frames.filter((f) => (f.t - last >= 1000 / fps - 8 ? ((last = f.t), true) : false));
  }
  let m = initialMachineState(frames[0].t);
  for (const f of frames) {
    let poses = [...(f.kp ? [f.kp] : []), ...(f.alt ?? [])].map(unflat);
    if (edit) poses = edit(poses, f);
    const kp = tracker ? tracker.pick(poses, f.t) : (poses[0] ?? null);
    const r = stepMachine(m, ex.update(kp, f.t));
    m = r.state;
    for (const e of r.events) {
      if (e.type === 'settled') {
        ex.rebase();
        tracker?.anchor();
      }
      if (e.type === 'reanchor') {
        ex.reanchor();
        tracker?.anchor();
      }
      if (e.type === 'paused') tracker?.release();
    }
  }
  return m.count;
}

describe('真实录制回放', () => {
  for (const [stamp, reps, what] of RECORDINGS) {
    const raw = Object.entries(files).find(([path]) => path.includes(stamp))?.[1];
    it.skipIf(!raw)(`${what} → 计 ${reps}`, () => {
      if (!raw) return;
      expect(replay(raw)).toBe(reps);
      expect(replay(raw, 15)).toBe(reps);
    });
  }
});

describe('多人入镜（MediaPipe 录制注入旁人）', () => {
  const raw = Object.entries(files).find(([path]) => path.includes('T05-38-59-296Z'))?.[1];
  it.skipIf(!raw)('旁人始终站在右侧，本人趴下时只剩旁人 → 仍计 3', () => {
    if (!raw) return;
    const d = JSON.parse(raw);
    // 旁人：起始站姿整体右移 0.3（约 1.8 个肩宽）
    const stand = unflat(d.frames.find((f: RecFrame) => f.sig && f.kp).kp).map((k) => ({ ...k, x: k.x + 0.3 }));
    const edit = (poses: Keypoint[][], f: RecFrame) => (f.st === 'PRONE' ? [stand] : [...poses, stand]);
    expect(replay(raw, undefined, edit)).toBe(3);
    expect(replay(raw, 15, edit)).toBe(3);
  });
});

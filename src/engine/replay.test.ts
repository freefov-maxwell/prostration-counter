// 用手机导出的真实调试录制回放引擎（同一人、同一台 iPhone、手机放地面）。
// 录制文件放在 data/（不入库），本地有哪段就回放哪段，CI 上自动跳过。
import { describe, expect, it } from 'vitest';
import { SignalExtractor } from './signals';
import { initialMachineState, stepMachine } from './stateMachine';

const files = import.meta.glob<string>('../../data/*.json', { query: '?raw', import: 'default', eager: true });

/** [录制文件时间戳, 实际大礼拜次数, 内容] */
const RECORDINGS: [string, number, string][] = [
  ['T05-33-36-465Z', 3, 'movenet：先走近镜头再退回 3 次，再 3 拜'],
  ['T05-38-59-296Z', 3, 'mediapipe：先走近镜头再退回 3 次，再 3 拜'],
  ['T08-09-03-858Z', 9, 'movenet 15fps：正常 3 拜、快拜 3、合掌挡脸起身 2、跪停 5s 后起身 1'],
  ['T08-10-50-501Z', 0, 'movenet 15fps：鞠躬、走到手机前蹲下、坐地、走动'],
  ['T08-12-03-977Z', 3, 'movenet 15fps：拜后不回原位（向前漂移后又退回）'],
  // T08-40-59-758Z / T08-42-11-849Z：叩头（跪拜不扑地）+ 大礼拜，叩头目前会被计数，暂不纳入
];

/** fps：按 App 的推理限速降采样回放（录制时为 43–60fps，App 现限速 15fps）。 */
function replay(raw: string, fps?: number): number {
  const d = JSON.parse(raw);
  const ex = new SignalExtractor(d.baseline0);
  let frames = d.frames.filter((f: { sig?: unknown }) => f.sig); // 只回放计数阶段
  if (fps) {
    let last = -Infinity;
    frames = frames.filter((f: { t: number }) => (f.t - last >= 1000 / fps - 8 ? ((last = f.t), true) : false));
  }
  let m = initialMachineState(frames[0].t);
  for (const f of frames) {
    const kp = f.kp
      ? Array.from({ length: 33 }, (_, i) => ({ x: f.kp[i * 4], y: f.kp[i * 4 + 1], z: f.kp[i * 4 + 2], visibility: f.kp[i * 4 + 3] }))
      : null;
    const r = stepMachine(m, ex.update(kp, f.t));
    m = r.state;
    for (const e of r.events) {
      if (e.type === 'settled') ex.rebase();
      if (e.type === 'reanchor') ex.reanchor();
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

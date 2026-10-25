import { describe, expect, it } from 'vitest';
import { SubjectTracker, lateral } from './subject';
import { KP, Keypoint } from './types';

function kp(x: number, y: number, visibility = 0.9): Keypoint {
  return { x, y, z: 0, visibility };
}

/** 站姿，肩宽 0.2，dx 整体平移，s 以画面中心为原点缩放（远近）。 */
function person(dx = 0, s = 1, over: Partial<Record<number, Keypoint>> = {}): Keypoint[] {
  const frame: Keypoint[] = Array.from({ length: 33 }, () => kp(0.5, 0.5, 0.1));
  frame[KP.nose] = kp(0.5, 0.1);
  frame[KP.leftShoulder] = kp(0.4, 0.25);
  frame[KP.rightShoulder] = kp(0.6, 0.25);
  frame[KP.leftHip] = kp(0.45, 0.5);
  frame[KP.rightHip] = kp(0.55, 0.5);
  frame[KP.leftAnkle] = kp(0.45, 0.9);
  frame[KP.rightAnkle] = kp(0.55, 0.9);
  for (const [i, v] of Object.entries(over)) if (v) frame[Number(i)] = v;
  return frame.map((k) => ({ ...k, x: 0.5 + (k.x - 0.5) * s + dx, y: 0.5 + (k.y - 0.5) * s }));
}

const me = person();
const other = person(0.3, 0.8); // 右侧 1.9 个肩宽、略远
const HIDDEN = (x: number, y: number) => kp(x, y, 0.1);

/** 锁定在本人身上，并让帧间连续失效（隔 1s 再选）。 */
function locked(): SubjectTracker {
  const tr = new SubjectTracker();
  for (let i = 0; i < 5; i++) tr.pick([me], i * 60);
  tr.anchor();
  return tr;
}

describe('SubjectTracker 多人时锁定本人', () => {
  it('侧向位置与远近无关', () => {
    expect(lateral(person(0.05, 1))!).toBeCloseTo(lateral(person(0.05 * 2, 2))!, 5);
  });

  it('站位阶段两人：选离镜头近（框大）的', () => {
    expect(new SubjectTracker().pick([other, me], 0)).toBe(me);
  });

  it('锁定后两人同在：选本人，与候选顺序无关', () => {
    expect(locked().pick([other, me], 1000)).toBe(me);
    expect(locked().pick([me, other], 1000)).toBe(me);
  });

  it('锁定后只剩旁人：返回 null（按人丢失处理）', () => {
    expect(locked().pick([other], 1000)).toBeNull();
  });

  it('本人趴下肩不可见、旁人可见：选本人', () => {
    const prone = person(0, 2, { [KP.leftShoulder]: HIDDEN(0.4, 0.25), [KP.rightShoulder]: HIDDEN(0.6, 0.25) });
    expect(locked().pick([other, prone], 1000)).toBe(prone);
  });

  it('帧间连续：扑向镜头的大幅动作也跟得住', () => {
    const tr = locked();
    tr.pick([me], 1000);
    const near = person(0, 2.5);
    expect(tr.pick([other, near], 1060)).toBe(near);
  });

  it('release 后解锁：只剩旁人也会选中', () => {
    const tr = locked();
    tr.release();
    expect(tr.pick([other], 1000)).toBe(other);
  });
});

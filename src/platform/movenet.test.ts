import { describe, expect, it } from 'vitest';
import { fullBox, nextBox } from './movenet';

const pt = (x: number, y: number, score = 0.9) => ({ x, y, score });

describe('MoveNet 裁剪框', () => {
  it('竖屏整帧补成正方形', () => {
    // 480×640：正方形边长 640 像素 = 帧宽的 4/3
    const [y1, x1, y2, x2] = fullBox(480, 640);
    expect([y1, y2]).toEqual([0, 1]);
    expect((x2 - x1) * 480).toBeCloseTo(640);
  });

  it('以髋为中心，框住全身', () => {
    const kp = Array.from({ length: 17 }, () => pt(0.5, 0.5, 0));
    kp[0] = pt(0.5, 0.2); // 鼻
    kp[5] = pt(0.45, 0.3);
    kp[6] = pt(0.55, 0.3);
    kp[11] = pt(0.46, 0.55);
    kp[12] = pt(0.54, 0.55);
    kp[15] = pt(0.47, 0.85); // 踝
    const box = nextBox(kp, 480, 640)!;
    expect(box[0]).toBeLessThan(0.2);
    expect(box[2]).toBeGreaterThan(0.85);
    expect((box[1] + box[3]) / 2).toBeCloseTo(0.5);
  });

  it('躯干不可靠时回整帧', () => {
    expect(nextBox(Array.from({ length: 17 }, () => pt(0.5, 0.5, 0.1)), 480, 640)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { initialMachineState, MachineEvent, MachineState, stepMachine } from './stateMachine';
import { FrameSignals } from './types';

const DT = 60; // 帧间隔 60ms ≈ 15fps

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
    noseY: 0.2,
    hipY: 0.5,
    handMaxY: 0.6,
    ...over,
  };
}

class Driver {
  state: MachineState = initialMachineState(0);
  events: MachineEvent[] = [];
  t = 0;

  feed(n: number, over: Partial<FrameSignals> = {}) {
    for (let i = 0; i < n; i++) {
      this.t += DT;
      const r = stepMachine(this.state, makeSig(this.t, over));
      this.state = r.state;
      this.events.push(...r.events);
    }
  }

  /** 人离开：LOST 且画面无运动能量 */
  feedLost(seconds: number) {
    this.feed(Math.round((seconds * 1000) / DT), {
      quality: 'LOST',
      valid: false,
      hipDrop: null,
      torsoAngle: null,
      headDrop: null,
      motionEnergy: 0,
    });
  }

  /** 一个完整大礼拜周期：下拜 → 俯地（PARTIAL 帧推断）→ 起身 → 站定 */
  rep() {
    this.feed(4, { hipDrop: 0.4, torsoAngle: 50, headDrop: 0.4 });
    this.feed(6, { hipDrop: 0.8, torsoAngle: 80, headDrop: 0.7, closeness: true, quality: 'PARTIAL' });
    this.feed(3, { hipDrop: 0.8, torsoAngle: 80, headDrop: 0.7, closeness: true, quality: 'PARTIAL' });
    this.feed(4, { hipDrop: 0.3, torsoAngle: 30, headDrop: 0.2 });
    this.feed(8, {});
  }

  repEvents() {
    return this.events.filter((e) => e.type === 'repCompleted');
  }
}

describe('RepStateMachine', () => {
  it('连续 3 个完整周期计 3', () => {
    const d = new Driver();
    d.feed(8); // 初始站立 → STANDING
    expect(d.state.state).toBe('STANDING');
    d.rep();
    d.rep();
    d.rep();
    expect(d.state.count).toBe(3);
    expect(d.repEvents()).toHaveLength(3);
    expect(d.state.state).toBe('STANDING');
  });

  it('半途起身不计数', () => {
    const d = new Driver();
    d.feed(8);
    d.feed(4, { hipDrop: 0.4, torsoAngle: 50, headDrop: 0.4 }); // DESCENDING
    expect(d.state.state).toBe('DESCENDING');
    d.feed(8); // 直接起身回站立
    expect(d.state.state).toBe('STANDING');
    expect(d.state.count).toBe(0);
  });

  it('站立不动、弯腰捡物不计数', () => {
    const d = new Driver();
    d.feed(30); // 长时间站立
    expect(d.state.count).toBe(0);
    // 弯腰：headDrop 升高但无贴近特征、无俯地
    d.feed(5, { hipDrop: 0.35, torsoAngle: 45, headDrop: 0.45 });
    d.feed(8, {});
    expect(d.state.count).toBe(0);
  });

  it('人走开后自动暂停，回来继续计数不重复', () => {
    const d = new Driver();
    d.feed(8);
    d.rep();
    expect(d.state.count).toBe(1);

    // 下一拜下到一半人离开
    d.feed(3, { hipDrop: 0.4, torsoAngle: 50, headDrop: 0.4 });
    d.feedLost(4);
    expect(d.state.state).toBe('PAUSED');
    expect(d.events.some((e) => e.type === 'paused')).toBe(true);

    // 回来站好：自动恢复，不重复计数
    d.feed(8);
    expect(d.events.some((e) => e.type === 'resumed')).toBe(true);
    expect(d.state.state).toBe('STANDING');
    expect(d.state.count).toBe(1);

    d.rep();
    expect(d.state.count).toBe(2);
  });

  it('连续 LOST 超 10 秒（有运动）也进入暂停', () => {
    const d = new Driver();
    d.feed(8);
    d.feed(11 * 17, {
      quality: 'LOST',
      valid: false,
      hipDrop: null,
      torsoAngle: null,
      headDrop: null,
      motionEnergy: 0.5,
    });
    expect(d.state.state).toBe('PAUSED');
  });

  it('PRONE 长时间停留不计数也不出错，起身后正常计数', () => {
    const d = new Driver();
    d.feed(8);
    d.feed(4, { hipDrop: 0.4, torsoAngle: 50, headDrop: 0.4 });
    d.feed(6, { hipDrop: 0.8, torsoAngle: 80, headDrop: 0.7, closeness: true, quality: 'PARTIAL' });
    // 趴著休息（远超 60 秒也无妨，这里模拟 30 秒）
    d.feed(500, { hipDrop: 0.8, torsoAngle: 80, headDrop: 0.7, closeness: true, quality: 'PARTIAL' });
    expect(d.state.state).toBe('PRONE');
    expect(d.state.count).toBe(0);
    d.feed(4, { hipDrop: 0.3, torsoAngle: 30, headDrop: 0.2 });
    d.feed(8, {});
    expect(d.state.count).toBe(1);
  });
});

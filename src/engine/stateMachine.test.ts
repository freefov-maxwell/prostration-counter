import { describe, expect, it } from 'vitest';
import { initialMachineState, MachineEvent, MachineState, stepMachine } from './stateMachine';
import { FrameSignals } from './types';

const DT = 60; // 帧间隔 60ms ≈ 15fps

const STAND: Partial<FrameSignals> = { standing: true, lowness: 0 };
const GOING_DOWN: Partial<FrameSignals> = { standing: false, lowness: 0.6 };
const LOW: Partial<FrameSignals> = { standing: false, lowness: 1.5 };
/** 回收成蹲 / 跪：不够低也不算站直。 */
const SQUAT: Partial<FrameSignals> = { standing: false, lowness: 0.5 };
const LOST: Partial<FrameSignals> = { quality: 'LOST', valid: false, standing: false };

function makeSig(t: number, over: Partial<FrameSignals>): FrameSignals {
  return {
    t,
    quality: 'FULL',
    valid: true,
    headDrop: 0,
    scale: 1,
    heightRatio: 1,
    upright: true,
    standing: false,
    lowness: 0,
    ...over,
  };
}

class Driver {
  state: MachineState = initialMachineState(0);
  events: MachineEvent[] = [];
  t = 0;
  lowness = 0;

  feed(ms: number, over: Partial<FrameSignals>) {
    for (let i = 0; i < ms / DT; i++) {
      this.t += DT;
      // LOST 帧沿用上一有效 lowness（与 SignalExtractor 一致）
      if (over.lowness != null) this.lowness = over.lowness;
      const r = stepMachine(this.state, makeSig(this.t, { lowness: this.lowness, ...over }));
      this.state = r.state;
      this.events.push(...r.events);
    }
    return this;
  }

  /** 一个完整大礼拜：下拜 → 俯地（含伸展）→ 回收成蹲 → 站起。 */
  rep() {
    return this.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, SQUAT).feed(1000, STAND);
  }

  count(type: MachineEvent['type']) {
    return this.events.filter((e) => e.type === type).length;
  }
}

describe('计数状态机：下拜 → 起身', () => {
  it('站好后连续 3 拜计 3，每拜各上膛一次', () => {
    const d = new Driver().feed(1000, STAND);
    expect(d.state.state).toBe('STANDING');
    d.rep().rep().rep();
    expect(d.state.count).toBe(3);
    expect(d.count('repCompleted')).toBe(3);
    expect(d.count('armed')).toBe(3);
  });

  it('站直保持不足 0.5s 不计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(2000, LOW).feed(300, STAND).feed(600, SQUAT);
    expect(d.state.count).toBe(0);
  });

  it('低位期间反复起伏（伸展、仰头）只上膛一次、只计一次', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(1500, LOW).feed(500, SQUAT).feed(800, LOW).feed(500, SQUAT).feed(800, LOW);
    d.feed(1000, SQUAT).feed(1000, STAND);
    expect(d.count('armed')).toBe(1);
    expect(d.state.count).toBe(1);
  });

  it('弯腰点头（低位不足 1s）不计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(300, GOING_DOWN).feed(600, LOW).feed(1000, STAND);
    expect(d.count('armed')).toBe(0);
    expect(d.state.count).toBe(0);
    expect(d.state.state).toBe('STANDING');
  });

  it('半途起身（没到低位）不计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(2000, GOING_DOWN);
    expect(d.state.state).toBe('DESCENDING');
    d.feed(1000, STAND);
    expect(d.state.state).toBe('STANDING');
    expect(d.state.count).toBe(0);
  });

  it('单帧抖动不触发下拜', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(DT, GOING_DOWN).feed(1000, STAND);
    expect(d.count('stateChanged')).toBe(1); // 只有 IDLE → STANDING
  });

  it('下拜 15s 仍到不了低位 → 作废，需重新站好', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(16000, GOING_DOWN);
    expect(d.state.state).toBe('IDLE');
    d.feed(3000, LOW).feed(1000, STAND);
    expect(d.state.count).toBe(0);
  });

  it('下拜中脸贴地识别丢失，丢失时间计入低位并上膛', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, { standing: false, lowness: 0.8 }).feed(2000, LOST);
    expect(d.count('armed')).toBe(1);
    d.feed(1000, SQUAT).feed(1000, STAND);
    expect(d.state.count).toBe(1);
  });
});

describe('丢失与暂停', () => {
  it('低位中丢失 40s（< 60s）回来站起，正常计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(1500, LOW).feed(40000, LOST).feed(1000, SQUAT).feed(1000, STAND);
    expect(d.count('paused')).toBe(0);
    expect(d.state.count).toBe(1);
  });

  it('低位中丢失超 60s：本拜作废并暂停；回来后继续计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(1500, LOW).feed(61000, LOST);
    expect(d.count('repDiscarded')).toBe(1);
    expect(d.state.state).toBe('PAUSED');
    d.feed(1000, STAND);
    expect(d.count('resumed')).toBe(1);
    expect(d.state.state).toBe('STANDING');
    expect(d.state.count).toBe(0);
    d.rep();
    expect(d.state.count).toBe(1);
  });

  it('站立时看不到人超过 10s → 暂停', () => {
    const d = new Driver().feed(1000, STAND).feed(9000, LOST);
    expect(d.state.state).toBe('STANDING');
    d.feed(2000, LOST);
    expect(d.state.state).toBe('PAUSED');
    expect(d.count('repDiscarded')).toBe(0);
  });
});

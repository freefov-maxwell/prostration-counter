import { describe, expect, it } from 'vitest';
import { initialMachineState, MachineEvent, MachineState, stepMachine } from './stateMachine';
import { FrameSignals } from './types';

const DT = 60; // 帧间隔 60ms ≈ 15fps

const STAND: Partial<FrameSignals> = { standing: true, stance: true, lowness: 0 };
const GOING_DOWN: Partial<FrameSignals> = { standing: false, lowness: 0.6, headDrop: 0.8, heightRatio: null };
const LOW: Partial<FrameSignals> = { standing: false, lowness: 1.5, headDrop: 1.0, heightRatio: null };
/** 站着走近镜头：远近比变大，但头在画面里上升、表观身高变高。 */
const WALK_IN: Partial<FrameSignals> = { standing: false, lowness: 1.5, headDrop: -0.7, heightRatio: 1.8 };
/** 回收成蹲 / 跪：不够低也不算站直。 */
const SQUAT: Partial<FrameSignals> = { standing: false, lowness: 0.5, headDrop: 0.6, heightRatio: 0.6 };
/** 起身中途：头已接近站姿高度，但还没严格站直。 */
const RISING_UP: Partial<FrameSignals> = { standing: false, lowness: 0.1, headDrop: 0.3, heightRatio: 0.7 };
const NEAR_UP: Partial<FrameSignals> = { standing: false, stance: true, lowness: 0.1, headDrop: 0.1, heightRatio: 0.85 };
/** 站起后合掌举过头顶：肩宽变窄、略低头，不满足严格站直。 */
const PALMS_UP: Partial<FrameSignals> = { standing: false, stance: true, lowness: -0.4, headDrop: 0.17, scale: 0.72, heightRatio: 0.94 };
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
    stance: false,
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

  /** 一个完整归元瑜伽：俯身 → 俯地（含伸展）→ 回收成蹲 → 站起。 */
  rep() {
    return this.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, SQUAT).feed(1000, STAND);
  }

  /** 连贯动作：从跪姿用约 0.4s 起身，紧接合掌举过头顶，从不严格站直。 */
  flowingRep() {
    return this.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, SQUAT).feed(180, RISING_UP).feed(180, NEAR_UP).feed(600, PALMS_UP);
  }

  count(type: MachineEvent['type']) {
    return this.events.filter((e) => e.type === type).length;
  }
}

describe('计数状态机：俯身 → 起身', () => {
  it('站好后连续 3 拜计 3，每次各上膛一次', () => {
    const d = new Driver().feed(1000, STAND);
    expect(d.state.state).toBe('STANDING');
    d.rep().rep().rep();
    expect(d.state.count).toBe(3);
    expect(d.count('repCompleted')).toBe(3);
    expect(d.count('armed')).toBe(3);
  });

  it('直立不足 150ms 不计数；起身后直立 0.3s 即算完成（不要求站稳 0.5s）', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(2000, LOW).feed(120, STAND).feed(600, SQUAT);
    expect(d.state.count).toBe(0);
    d.feed(300, STAND).feed(600, SQUAT);
    expect(d.state.count).toBe(1);
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

  it('单帧抖动不触发俯身', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(DT, GOING_DOWN).feed(1000, STAND);
    expect(d.count('stateChanged')).toBe(1); // 只有 IDLE → STANDING
  });

  it('俯身 15s 仍到不了低位 → 作废，需重新站好', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(16000, GOING_DOWN);
    expect(d.state.state).toBe('IDLE');
    d.feed(3000, LOW).feed(1000, STAND);
    expect(d.state.count).toBe(0);
  });

  it('站着走近镜头再退回（远近比够大）不上膛、不计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(3000, WALK_IN).feed(1000, GOING_DOWN).feed(1000, STAND);
    expect(d.count('armed')).toBe(0);
    expect(d.state.count).toBe(0);
    d.rep();
    expect(d.state.count).toBe(1);
  });

  it('远近比够大但头没下沉（如蹲在镜头前）不上膛', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(3000, { ...LOW, headDrop: 0.2 });
    expect(d.count('armed')).toBe(0);
  });

  it('连贯动作：起身后立刻合掌、接着再拜，每次都计且不合并', () => {
    const d = new Driver().feed(1000, STAND);
    d.flowingRep().flowingRep().flowingRep();
    expect(d.state.count).toBe(3);
    expect(d.count('armed')).toBe(3);
  });

  it('直立终点只出现一瞬（识别跳变）不计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, SQUAT).feed(DT, NEAR_UP).feed(600, SQUAT);
    expect(d.state.count).toBe(0);
  });

  it('从离镜头较近的跪姿直接起身、紧接合掌，也能计数（起点不限距离）', () => {
    const d = new Driver().feed(1000, STAND);
    for (let i = 0; i < 2; i++) {
      d.feed(600, GOING_DOWN).feed(3000, { ...LOW, scale: 2.0 }).feed(1500, { ...SQUAT, scale: 1.5 });
      d.feed(180, { ...RISING_UP, scale: 1.2 }).feed(180, NEAR_UP).feed(600, PALMS_UP);
    }
    expect(d.state.count).toBe(2);
  });

  it('上膛后在低位停留超过回看窗口才站起：不按起身计，由静态站直兜底', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(3000, LOW).feed(4000, { ...PALMS_UP, stance: false, lowness: 0.5, headDrop: 0.3 }).feed(300, NEAR_UP);
    expect(d.state.count).toBe(0);
    d.feed(1000, STAND);
    expect(d.state.count).toBe(1);
  });

  it('离镜头很近时直起上身（跪在镜头前）不算起身', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, { ...SQUAT, scale: 2.3 });
    d.feed(180, { ...RISING_UP, scale: 2.3 }).feed(600, { ...NEAR_UP, scale: 2.3 });
    expect(d.state.count).toBe(0);
  });

  it('计数后严格站直保持才发 settled（校准基准），连贯动作不发', () => {
    const d = new Driver().feed(1000, STAND);
    expect(d.count('settled')).toBe(1);
    d.flowingRep();
    expect(d.count('settled')).toBe(1);
    d.feed(1000, STAND);
    expect(d.count('settled')).toBe(2);
  });

  it('站位漂移（稳稳站着但对不上基准）0.8s 后请求重取基准，不卡在 IDLE', () => {
    const d = new Driver().feed(1000, STAND);
    // 实际路径：被当成俯身 → 表观身高高于基准，判为走近作废 → IDLE → 站稳 0.8s 重取基准
    d.feed(1500, { standing: false, stance: true, lowness: 0.6, headDrop: -0.3, heightRatio: 1.34 });
    expect(d.count('reanchor')).toBe(1);
    expect(d.count('armed')).toBe(0);
    d.feed(600, STAND); // 重取基准后即判站直
    expect(d.state.state).toBe('STANDING');
    d.rep();
    expect(d.state.count).toBe(1);
  });

  it('拜后退到比原位更远处站起（基准对不上）也计数', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, SQUAT).feed(180, RISING_UP);
    d.feed(600, { standing: false, stance: true, lowness: -0.5, headDrop: 0.2, scale: 0.75, heightRatio: 0.75 });
    expect(d.state.count).toBe(1);
  });

  it('跪直（腿看似伸直但身高与肩宽之比偏小）不算起身', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, GOING_DOWN).feed(3000, LOW).feed(1000, { standing: false, stance: true, lowness: -0.2, headDrop: 0.26, scale: 0.87, heightRatio: 0.7 });
    expect(d.state.count).toBe(0);
  });

  it('站直时、走动 / 俯身中（站姿不成立）不重取基准', () => {
    const d = new Driver().feed(3000, STAND);
    d.feed(600, GOING_DOWN).feed(3000, LOW).feed(1500, SQUAT).feed(1000, STAND);
    expect(d.count('reanchor')).toBe(0);
  });

  it('俯身中脸贴地识别丢失，丢失时间计入低位并上膛', () => {
    const d = new Driver().feed(1000, STAND);
    d.feed(600, { ...GOING_DOWN, lowness: 0.8 }).feed(2000, LOST);
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

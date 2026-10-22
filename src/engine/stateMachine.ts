// 计数状态机：识别一个完整的"下拜 → 起身"才计 1 次。纯函数：无 IO、无依赖，可回放单测。
//
//   IDLE ─站直保持─▶ STANDING ─下拜趋势─▶ DESCENDING ─低位累计 1s（上膛）─▶ PRONE ⇄ RISING ─站直保持─▶ 计数
//
// 低位期间（伸展、仰头、回收成蹲等）不对具体动作做假设，只等"重新站直"。
import { FrameSignals } from './types';
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';

export type RepState = 'IDLE' | 'STANDING' | 'DESCENDING' | 'PRONE' | 'RISING' | 'PAUSED';

export interface MachineState {
  state: RepState;
  count: number;
  stateEnteredAt: number;
  /** 站直条件的持续计时起点。 */
  standSince: number | null;
  /** 下拜趋势的持续计时起点。 */
  descendSince: number | null;
  /** DESCENDING 中低位累计时长。 */
  lowMs: number;
  lastT: number | null;
  lastValidAt: number;
}

export type MachineEvent =
  | { type: 'repCompleted'; count: number }
  /** 到达低位并确认：这一拜站起来即计数。 */
  | { type: 'armed' }
  /** 已上膛但长时间看不到人：本拜作废。 */
  | { type: 'repDiscarded' }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'stateChanged'; from: RepState; to: RepState };

export function initialMachineState(now = 0): MachineState {
  return {
    state: 'IDLE',
    count: 0,
    stateEnteredAt: now,
    standSince: null,
    descendSince: null,
    lowMs: 0,
    lastT: null,
    lastValidAt: now,
  };
}

export function stepMachine(
  s: MachineState,
  sig: FrameSignals,
  th: Thresholds = DEFAULT_THRESHOLDS,
): { state: MachineState; events: MachineEvent[] } {
  const events: MachineEvent[] = [];
  const dt = s.lastT == null ? 0 : sig.t - s.lastT;
  let next: MachineState = { ...s, lastT: sig.t };

  const transit = (to: RepState) => {
    events.push({ type: 'stateChanged', from: next.state, to });
    next = { ...next, state: to, stateEnteredAt: sig.t, standSince: null, descendSince: null, lowMs: 0 };
  };
  const pause = () => {
    transit('PAUSED');
    events.push({ type: 'paused' });
  };
  const arm = () => {
    transit('PRONE');
    events.push({ type: 'armed' });
  };

  if (s.state === 'PAUSED') {
    if (sig.valid) {
      transit('IDLE');
      events.push({ type: 'resumed' });
    }
    return { state: next, events };
  }

  if (!sig.valid) {
    const lostFor = sig.t - s.lastValidAt;
    if (s.state === 'PRONE' || s.state === 'RISING') {
      // 脸贴地、离镜头太近时常识别不到，已上膛阶段宽容到 armedLostMs
      if (lostFor >= th.armedLostMs) {
        events.push({ type: 'repDiscarded' });
        pause();
      }
    } else if (s.state !== 'IDLE') {
      if (s.state === 'DESCENDING' && sig.lowness >= th.lostAsLowLowness) {
        next.lowMs = s.lowMs + dt;
        if (next.lowMs >= th.lowConfirmMs) arm();
      }
      if (next.state !== 'PRONE' && lostFor >= th.lostToPauseMs) pause();
    }
    return { state: next, events };
  }

  next.lastValidAt = sig.t;
  if (sig.standing) next.standSince = s.standSince ?? sig.t;
  else next.standSince = null;
  const standHeld = next.standSince != null && sig.t - next.standSince >= th.standHoldMs;
  const low = sig.lowness >= 1;

  switch (s.state) {
    case 'IDLE':
      if (standHeld) transit('STANDING');
      break;
    case 'STANDING':
      // 需连续若干帧保持下拜趋势，单帧抖动不触发
      if (!sig.standing && sig.lowness >= th.descendLowness) {
        next.descendSince = s.descendSince ?? sig.t;
        if (sig.t - next.descendSince >= th.descendConfirmMs) transit('DESCENDING');
      } else {
        next.descendSince = null;
      }
      break;
    case 'DESCENDING':
      if (low) {
        next.lowMs = s.lowMs + dt;
        if (next.lowMs >= th.lowConfirmMs) arm();
      } else if (standHeld) {
        transit('STANDING'); // 半途起身：不计数
      } else if (sig.t - s.stateEnteredAt > th.descendTimeoutMs) {
        transit('IDLE');
      }
      break;
    case 'PRONE':
      if (!low) transit('RISING');
      break;
    case 'RISING':
      if (low) {
        transit('PRONE'); // 起身途中又俯下（如伸展动作），保持上膛，不重复提示
      } else if (standHeld) {
        transit('STANDING');
        next.count = s.count + 1;
        events.push({ type: 'repCompleted', count: next.count });
      }
      break;
  }
  return { state: next, events };
}

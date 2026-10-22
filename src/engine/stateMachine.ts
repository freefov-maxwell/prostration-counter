// 计数状态机（技术文档 §4.3）。纯函数：无 IO、无依赖，可回放单测。
import { FrameSignals } from './types';
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';

export type RepState = 'IDLE' | 'STANDING' | 'DESCENDING' | 'PRONE' | 'RISING' | 'PAUSED';

export interface MachineState {
  state: RepState;
  count: number;
  stateEnteredAt: number;
  /** 站立条件的持续计时（滞回防抖）。 */
  pendingStandSince: number | null;
  /** 俯地条件的持续计时。 */
  pendingProneSince: number | null;
  lastValidAt: number;
}

export type MachineEvent =
  | { type: 'repCompleted'; count: number }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'stateChanged'; from: RepState; to: RepState };

export function initialMachineState(now = 0): MachineState {
  return {
    state: 'IDLE',
    count: 0,
    stateEnteredAt: now,
    pendingStandSince: null,
    pendingProneSince: null,
    lastValidAt: now,
  };
}

function enter(s: MachineState, to: RepState, t: number): MachineState {
  return { ...s, state: to, stateEnteredAt: t, pendingStandSince: null, pendingProneSince: null };
}

export function stepMachine(
  s: MachineState,
  sig: FrameSignals,
  th: Thresholds = DEFAULT_THRESHOLDS,
): { state: MachineState; events: MachineEvent[] } {
  const events: MachineEvent[] = [];
  let next: MachineState = sig.valid ? { ...s, lastValidAt: sig.t } : { ...s };

  const transit = (to: RepState) => {
    events.push({ type: 'stateChanged', from: next.state, to });
    next = enter(next, to, sig.t);
  };

  // —— 暂停/恢复（任何活动状态下 valid 连续丢失 → PAUSED）——
  if (s.state === 'PAUSED') {
    if (sig.valid) {
      transit('IDLE');
      events.push({ type: 'resumed' });
    }
    return { state: next, events };
  }
  if (!sig.valid) {
    if (s.state !== 'IDLE') {
      const lostFor = sig.t - s.lastValidAt;
      const goneQuiet = lostFor >= th.lostNoMotionMs && sig.motionEnergy < th.motionEnergyFloor;
      if (lostFor >= th.lostToPauseMs || goneQuiet) {
        transit('PAUSED');
        events.push({ type: 'paused' });
      }
    }
    // LOST 帧不做状态迁移，保持原状态（信号已由 SignalExtractor 冻结）
    return { state: next, events };
  }

  const { hipDrop, torsoAngle, headDrop } = sig;
  const standingLoose =
    hipDrop != null && torsoAngle != null &&
    hipDrop < th.standingMaxHipDrop && torsoAngle < th.standingMaxTorsoAngle;
  const standingFull = sig.quality === 'FULL' && standingLoose;
  const descending =
    (hipDrop != null && hipDrop > th.descendHipDrop) ||
    (torsoAngle != null && torsoAngle > th.descendTorsoAngle) ||
    (headDrop != null && headDrop > th.descendHeadDrop);
  const proneFull =
    sig.quality === 'FULL' && hipDrop != null && torsoAngle != null &&
    hipDrop > th.proneHipDrop && torsoAngle > th.proneTorsoAngle;
  // 正面摆放推断：headDrop 超阈值且出现贴近特征（帧质量可为 PARTIAL）
  const proneInferred =
    headDrop != null && headDrop > th.proneHeadDrop && (sig.closeness || !th.proneRequiresCloseness);
  const riseFull =
    sig.quality === 'FULL' && hipDrop != null && torsoAngle != null &&
    (hipDrop < th.riseHipDrop || torsoAngle < th.riseTorsoAngle);
  const riseInferred =
    !sig.closeness && headDrop != null && headDrop < th.proneHeadDrop - th.riseHeadDropHysteresis;
  const settledMs = sig.t - s.stateEnteredAt;

  switch (s.state) {
    case 'IDLE': {
      if (standingLoose) {
        const since = s.pendingStandSince ?? sig.t;
        next.pendingStandSince = since;
        if (sig.t - since >= th.standingHoldMs) transit('STANDING');
      } else {
        next.pendingStandSince = null;
      }
      break;
    }
    case 'STANDING': {
      if (descending) transit('DESCENDING');
      break;
    }
    case 'DESCENDING': {
      if (settledMs < th.minStateMs) break;
      if (proneFull || proneInferred) {
        const since = s.pendingProneSince ?? sig.t;
        next.pendingProneSince = since;
        next.pendingStandSince = null;
        if (sig.t - since >= th.proneHoldMs) transit('PRONE');
      } else if (standingFull) {
        // 半途起身：不计数，回到 STANDING 视为无效周期
        const since = s.pendingStandSince ?? sig.t;
        next.pendingStandSince = since;
        next.pendingProneSince = null;
        if (sig.t - since >= th.standingHoldMs) transit('STANDING');
      } else {
        next.pendingProneSince = null;
        next.pendingStandSince = null;
      }
      break;
    }
    case 'PRONE': {
      if (settledMs < th.minStateMs) break;
      // PRONE 停留再久也不强制重置（用户可能停留休息），等自然起身
      if (riseFull || riseInferred) transit('RISING');
      break;
    }
    case 'RISING': {
      if (settledMs < th.minStateMs) break;
      if (standingFull) {
        const since = s.pendingStandSince ?? sig.t;
        next.pendingStandSince = since;
        if (sig.t - since >= th.standingHoldMs) {
          transit('STANDING');
          next.count = s.count + 1;
          events.push({ type: 'repCompleted', count: next.count });
        }
      } else {
        next.pendingStandSince = null;
      }
      break;
    }
  }
  return { state: next, events };
}

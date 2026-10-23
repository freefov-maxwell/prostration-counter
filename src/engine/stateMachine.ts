// 计数状态机：识别一个完整的"下拜 → 起身"才计 1 次。纯函数：无 IO、无依赖，可回放单测。
//
//   IDLE ─站直保持─▶ STANDING ─下拜趋势─▶ DESCENDING ─低位累计 1s（上膛）─▶ PRONE ⇄ RISING ─起身完成─▶ 计数
//
// 低位期间（伸展、仰头、回收成蹲等）不对具体动作做假设，只等"重新站直"。
// 计数看"起身完成"而非严格站姿：先认终点（躯干直立、腿伸直，身高与肩宽之比接近站姿——与远近无关，
// 跪直时约 0.8；不比上一拜完成时近太多；不要求手臂下垂，站位前后漂移也认），
// 再回看终点前不久是否还在低位。起点姿态（跪 / 蹲 / 离镜头远近）不做判断。
// 起身后紧接合掌、举手（肩宽变窄、低头）也不会漏计；静态站直保持仍作兜底。
// 上膛还须看到"先低头、后扑近"：站着走近镜头远近比也会变大，但头在画面里是上升的、表观身高变高。
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
  /** DESCENDING 中头部明显下沉的累计时长。 */
  headDownMs: number;
  /** DESCENDING 中表观身高明显变高（站着走近镜头）的累计时长。 */
  approachMs: number;
  /** 已上膛后最近一次处于低位的时刻（头在跪姿高度、扑近镜头或识别不到）。 */
  lastLowAt: number | null;
  /** 已上膛后"直立"终点条件的持续计时起点。 */
  uprightSince: number | null;
  /** 上一拜完成时的远近比（起始为站姿基准 1），终点距离与之比较。 */
  doneScale: number;
  /** IDLE / STANDING 中"站姿成立但判不出站直"的持续计时起点。 */
  stanceSince: number | null;
  /** 本次 STANDING 已站稳（已发 settled）。 */
  settled: boolean;
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
  | { type: 'stateChanged'; from: RepState; to: RepState }
  /** 进入 STANDING 后首次严格站直保持：此时才适合校准站姿基准。 */
  | { type: 'settled' }
  /** 人稳稳站着但与基准对不上（站位漂移）：应以当前站姿重取基准。 */
  | { type: 'reanchor' };

export function initialMachineState(now = 0): MachineState {
  return {
    state: 'IDLE',
    count: 0,
    stateEnteredAt: now,
    standSince: null,
    descendSince: null,
    lowMs: 0,
    headDownMs: 0,
    approachMs: 0,
    lastLowAt: null,
    uprightSince: null,
    doneScale: 1,
    stanceSince: null,
    settled: false,
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
    const armed = to === 'PRONE' || to === 'RISING';
    next = {
      ...next,
      state: to,
      stateEnteredAt: sig.t,
      standSince: null,
      descendSince: null,
      lowMs: 0,
      headDownMs: 0,
      approachMs: 0,
      lastLowAt: armed ? next.lastLowAt : null,
      uprightSince: armed ? next.uprightSince : null,
      stanceSince: null,
      settled: false,
    };
  };
  const pause = () => {
    transit('PAUSED');
    events.push({ type: 'paused' });
  };
  const arm = () => {
    transit('PRONE');
    events.push({ type: 'armed' });
  };
  const headWentDown = () => next.headDownMs >= th.descendConfirmMs;

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
      next.lastLowAt = sig.t;
      // 脸贴地、离镜头太近时常识别不到，已上膛阶段宽容到 armedLostMs
      if (lostFor >= th.armedLostMs) {
        events.push({ type: 'repDiscarded' });
        pause();
      }
    } else if (s.state !== 'IDLE') {
      if (s.state === 'DESCENDING' && sig.lowness >= th.lostAsLowLowness) {
        next.lowMs = s.lowMs + dt;
        if (next.lowMs >= th.lowConfirmMs && headWentDown()) arm();
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

  // 起身完成：终点站姿保持片刻（防识别跳变），且回看终点前 riseWindowMs 内仍在低位。
  // 终点距离只限不比上一拜完成时近太多（排除跪在镜头前直起上身）；变远不限，合掌举手时肩宽会变窄。
  let rose = false;
  if (s.state === 'PRONE' || s.state === 'RISING') {
    if (low || (sig.headDrop != null && sig.headDrop >= th.riseFromHeadDrop)) next.lastLowAt = sig.t;
    const upright =
      sig.stance &&
      sig.scale != null &&
      sig.heightRatio != null &&
      sig.heightRatio / sig.scale >= th.uprightProportionMin &&
      sig.scale <= s.doneScale * th.standScaleMax;
    next.uprightSince = upright ? (s.uprightSince ?? sig.t) : null;
    rose =
      next.uprightSince != null &&
      sig.t - next.uprightSince >= th.uprightHoldMs &&
      next.lastLowAt != null &&
      next.uprightSince - next.lastLowAt <= th.riseWindowMs;
  }

  // 站位漂移（如拜后站到更靠前处）：旧基准下永远判不出站直，会卡在 IDLE；站稳片刻即重取基准
  if ((s.state === 'IDLE' || s.state === 'STANDING') && sig.stance && !sig.standing) {
    next.stanceSince = s.stanceSince ?? sig.t;
    if (sig.t - next.stanceSince >= th.reanchorMs) {
      next.stanceSince = null;
      events.push({ type: 'reanchor' });
    }
  } else {
    next.stanceSince = null;
  }

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
      if (sig.headDrop != null && sig.headDrop >= th.armHeadDrop) next.headDownMs = s.headDownMs + dt;
      if (sig.heightRatio != null && sig.heightRatio >= th.approachHeightRatio) next.approachMs = s.approachMs + dt;
      if (next.approachMs >= th.descendConfirmMs) {
        transit('IDLE'); // 站着走近镜头：不是下拜，作废，需重新站好
      } else if (low) {
        next.lowMs = s.lowMs + dt;
        if (next.lowMs >= th.lowConfirmMs && headWentDown()) arm();
      } else if (standHeld) {
        transit('STANDING'); // 半途起身：不计数
      } else if (sig.t - s.stateEnteredAt > th.descendTimeoutMs) {
        transit('IDLE');
      }
      break;
    case 'PRONE':
    case 'RISING':
      if (rose || (s.state === 'RISING' && standHeld)) {
        transit('STANDING');
        next.count = s.count + 1;
        next.doneScale = sig.scale ?? s.doneScale;
        events.push({ type: 'repCompleted', count: next.count });
      } else if (s.state === 'PRONE') {
        if (!low) transit('RISING');
      } else if (low) {
        transit('PRONE'); // 起身途中又俯下（如伸展动作），保持上膛，不重复提示
      }
      break;
  }
  if (next.state === 'STANDING' && !next.settled && standHeld) {
    next.settled = true;
    events.push({ type: 'settled' });
  }
  return { state: next, events };
}

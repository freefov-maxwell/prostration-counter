// 全部阈值集中一处。数值为几何估算的初值，需用调试导出的真实数据校准。

export interface Thresholds {
  /** 关键点 visibility 达标线。 */
  visibilityMin: number;
  /** visibility 突降不立刻判丢失：连续低置信帧数。 */
  lostFramesThreshold: number;
  /** 中值滤波窗口（帧）。 */
  medianWindow: number;

  // —— 姿态判定 ——
  /** 站直：|headDrop| 上限。 */
  standHeadDrop: number;
  /** 站直：远近比区间（太近 = 仰头/蹲在镜头前，不算站直）。 */
  standScaleMin: number;
  standScaleMax: number;
  /** 站直：表观身高比下限（蹲 / 跪会明显变矮）。 */
  standHeightRatio: number;
  /** 直立：躯干与竖直方向最大夹角（度）。 */
  uprightMaxAngle: number;
  /** 低位：headDrop 达到此值即 lowness = 1。 */
  lowHeadDrop: number;
  /** 低位：远近比达到此值即 lowness = 1（脸朝下看不到鼻子时靠肩宽）。 */
  lowScale: number;
  /** 头部下降只在远近比 ≥ 此值（人确实扑向镜头）时才计入低位：原地蹲起头降很多但远近比不变。 */
  lowHeadScaleMin: number;

  // —— 动作识别（时序） ——
  /** 离开站直且 lowness ≥ 此值，才算开始下拜。 */
  descendLowness: number;
  /** 下拜趋势需连续保持的时长，滤掉单帧抖动。 */
  descendConfirmMs: number;
  /** 低位累计时长下限：到达后"上膛"，排除弯腰点头。 */
  lowConfirmMs: number;
  /** 下拜开始后迟迟到不了低位 → 作废。 */
  descendTimeoutMs: number;
  /** 站直需保持的时长（起始与计数都用）。 */
  standHoldMs: number;
  /** 下拜中人丢失时，lowness ≥ 此值则丢失时间也计入低位（脸贴地常识别不到）。 */
  lostAsLowLowness: number;

  // —— 丢失 / 暂停 ——
  /** 站立或下拜阶段看不到人超过此时长 → 暂停。 */
  lostToPauseMs: number;
  /** 已上膛（低位）阶段看不到人超过此时长 → 本拜作废并暂停。 */
  armedLostMs: number;

  // —— 基准 ——
  /** 每次站直后基准向当前值靠拢的比例（容忍每拜之间站位前后移动）。 */
  baselineAdapt: number;
  /** 起始站位：人体高度下限（防站太远关键点过小）。 */
  targetHeightMin: number;
  /** 起始站位：腿长 / 躯干长 下限（站直约 1.6–1.9，蹲约 1）。 */
  readyLegRatio: number;
  /** 起始站位：保持期间鼻子位置最大浮动（帧高比例），超出视为没站稳。 */
  readyMaxDrift: number;
  /** 起始站位：姿态合格后的倒数时长，期间可继续微调。 */
  countdownMs: number;
  /** 起始站位：姿态短暂不合格的宽限，超过则倒数重来。 */
  readyGraceMs: number;
  /** 起始站位：倒数结束时取最后这段时间的姿态作基准，且需在此段内站稳。 */
  readyWindowMs: number;
  /** 头 / 脚距画面边缘的最小余量。 */
  inFrameMargin: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  visibilityMin: 0.5,
  lostFramesThreshold: 3,
  medianWindow: 5,

  standHeadDrop: 0.15,
  standScaleMin: 0.75,
  standScaleMax: 1.35,
  standHeightRatio: 0.8,
  uprightMaxAngle: 25,
  lowHeadDrop: 0.45,
  lowScale: 1.6,
  lowHeadScaleMin: 1.25,

  descendLowness: 0.3,
  descendConfirmMs: 150,
  lowConfirmMs: 1000,
  descendTimeoutMs: 15000,
  standHoldMs: 500,
  lostAsLowLowness: 0.6,

  lostToPauseMs: 10000,
  armedLostMs: 60000,

  baselineAdapt: 0.2,
  // 手机放地面时，安全距离（约 2.5m）下站姿高度仅占画面约 0.4
  targetHeightMin: 0.25,
  readyLegRatio: 1.3,
  readyMaxDrift: 0.03,
  countdownMs: 5000,
  readyGraceMs: 500,
  readyWindowMs: 1500,
  inFrameMargin: 0.05,
};

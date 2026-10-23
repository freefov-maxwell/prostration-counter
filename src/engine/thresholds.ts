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
  /** 离开站直且 lowness ≥ 此值，才算开始俯身。 */
  descendLowness: number;
  /** 俯身趋势需连续保持的时长，滤掉单帧抖动。 */
  descendConfirmMs: number;
  /** 低位累计时长下限：到达后"上膛"，排除弯腰点头。 */
  lowConfirmMs: number;
  /** 上膛前须见到头部下沉：headDrop ≥ 此值累计 descendConfirmMs（站着走近镜头头是上升的）。 */
  armHeadDrop: number;
  /** 俯身中表观身高比 ≥ 此值累计 descendConfirmMs → 判为站着走近镜头，本次作废。 */
  approachHeightRatio: number;
  /** 回看用的低位：headDrop ≥ 此值（跪 / 蹲的头部高度）或 lowness ≥ 1，不论远近。 */
  riseFromHeadDrop: number;
  /** 起身终点：身高比 / 远近比（即身高与肩宽之比相对站姿）下限。与远近无关：站着约 1，跪直约 0.8。 */
  uprightProportionMin: number;
  /** 终点需保持的时长（防识别跳变）。 */
  uprightHoldMs: number;
  /** 回看窗口：终点出现前此时长内仍在低位，才算一次起身。 */
  riseWindowMs: number;
  /** 俯身开始后迟迟到不了低位 → 作废。 */
  descendTimeoutMs: number;
  /** 站姿（不依赖基准）保持此时长却判不出站直 → 站位变了，重取基准。 */
  reanchorMs: number;
  /** 站直需保持的时长（起始与计数都用）。 */
  standHoldMs: number;
  /** 俯身中人丢失时，lowness ≥ 此值则丢失时间也计入低位（脸贴地常识别不到）。 */
  lostAsLowLowness: number;

  // —— 丢失 / 暂停 ——
  /** 站立或俯身阶段看不到人超过此时长 → 暂停。 */
  lostToPauseMs: number;
  /** 已上膛（低位）阶段看不到人超过此时长 → 本拜作废并暂停。 */
  armedLostMs: number;

  // —— 基准 ——
  /** 每次站直后基准向当前值靠拢的比例（容忍每次之间站位前后移动）。 */
  baselineAdapt: number;
  /** 起始站位：人体高度下限（防站太远关键点过小）。 */
  targetHeightMin: number;
  /** 起始站位：腿长 / 躯干长 下限（站直约 1.6–1.9，蹲约 1，跪约 0.5）。取严，保证基准采自站直。 */
  readyLegRatio: number;
  /** 计数中的站姿（起身终点、重取基准）：腿长 / 躯干长 下限，比起始站位宽松。 */
  stanceLegRatio: number;
  /** 起始站位：窗口内鼻子位置最大浮动（帧宽/帧高比例），超出视为在移动。 */
  readyMaxDrift: number;
  /** 起始站位：窗口内人体高度最大相对浮动，超出视为在前后走动。 */
  readyMaxScaleDrift: number;
  /** 起始站位：倒数时长，期间移动则回到站位调整。 */
  countdownMs: number;
  /** 起始站位：姿态短暂不合格的宽限（防识别抖动），超过则回到站位调整。 */
  readyGraceMs: number;
  /** 起始站位：判断静止的滑动窗口，静止满一个窗口才开始倒数；倒数结束时也取这段姿态作基准。 */
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
  // 1.35 时漂移回放已在边缘（1.3 即漏计），留余量
  standScaleMax: 1.5,
  standHeightRatio: 0.8,
  uprightMaxAngle: 25,
  lowHeadDrop: 0.45,
  lowScale: 1.6,
  lowHeadScaleMin: 1.25,

  descendLowness: 0.3,
  descendConfirmMs: 150,
  lowConfirmMs: 1000,
  // 实测（两模型各 3 拜 / 3 次走近）：真拜 headDrop 峰值 1.2–1.3、身高比 ≤ 1.0；走近 headDrop ≤ 0.05、身高比 1.9–2.9
  // 走到手机前弯腰实测 headDrop 0.43；回放 0.4–1.1 全对，取中
  armHeadDrop: 0.7,
  approachHeightRatio: 1.3,
  // 实测起身（跪姿高度 → 站姿高度）耗时 300–520ms，终点远近比 0.99–1.06；识别跳变 < 120ms
  riseFromHeadDrop: 0.4,
  // 实测站着（含漂移到前 / 后、合掌）p10 ≥ 0.94；跪直合掌挡脸 p90 0.86
  uprightProportionMin: 0.9,
  uprightHoldMs: 150,
  riseWindowMs: 3000,
  descendTimeoutMs: 15000,
  standHoldMs: 500,
  // 实测：拜后向前漂移到远近比 1.3 处站定约 2.5s 再拜；需在其内完成重取基准 + 站直保持
  reanchorMs: 800,
  lostAsLowLowness: 0.6,

  lostToPauseMs: 10000,
  armedLostMs: 60000,

  baselineAdapt: 0.2,
  // 手机放地面时，安全距离（约 2.5m）下站姿高度仅占画面约 0.4
  targetHeightMin: 0.25,
  readyLegRatio: 1.3,
  // 跪直被误认腿直由 uprightProportionMin 把关；1.4 起站姿会漏判，取 1.1 留余量
  stanceLegRatio: 1.1,
  readyMaxDrift: 0.03,
  readyMaxScaleDrift: 0.08,
  countdownMs: 5000,
  readyGraceMs: 500,
  readyWindowMs: 1500,
  inFrameMargin: 0.05,
};

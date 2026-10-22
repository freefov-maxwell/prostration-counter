// 全部阈值集中一处（技术文档 §4.3 / §5.1 初值，M0 实测后再校准）。

export interface Thresholds {
  /** 关键点 visibility 达标线。 */
  visibilityMin: number;
  /** visibility 突降不立刻判丢失：连续低置信帧数。 */
  lostFramesThreshold: number;
  /** 中值滤波窗口（帧）。 */
  medianWindow: number;

  // —— 状态机迁移（带滞回） ——
  standingMaxHipDrop: number;
  standingMaxTorsoAngle: number;
  standingHoldMs: number;
  descendHipDrop: number;
  descendTorsoAngle: number;
  descendHeadDrop: number;
  proneHipDrop: number;
  proneTorsoAngle: number;
  /** 正面摆放推断 PRONE 的 headDrop 阈值。 */
  proneHeadDrop: number;
  /** 正面推断 PRONE 是否还要求贴近特征（试拜个性化后由实测俯地深度代替，置 false）。 */
  proneRequiresCloseness: boolean;
  proneHoldMs: number;
  riseHipDrop: number;
  riseTorsoAngle: number;
  /** 推断起身的 headDrop 回落滞回量。 */
  riseHeadDropHysteresis: number;
  /** DESCENDING/PRONE/RISING 最短停留，防一帧抖动连跳。 */
  minStateMs: number;
  /** 连续 LOST 且无运动能量 → 按"人离开"暂停。 */
  lostNoMotionMs: number;
  /** 任何状态下 valid 连续丢失超过该时长 → 自动暂停（PRD F4 默认 10s）。 */
  lostToPauseMs: number;
  /** 运动能量低于此值视为"画面无运动"。 */
  motionEnergyFloor: number;

  // —— 校准 ——
  /** 站姿人体高度下限：只防站得太远导致关键点过小；不设上限（过近会表现为头/脚出画）。 */
  targetHeightMin: number;
  calibrationHoldMs: number;
  inFrameMargin: number;
  /** 人脸变大判定：眼距相对站姿基准放大倍数。 */
  closenessEyeScale: number;
  /** 头部出界判定 y。 */
  noseOutBottomY: number;

  // —— 碰撞预判 ——
  collisionWarnY: number;
  collisionBlockY: number;
  /** 成人双眼间距生理恒常数（cm），建立 px/cm 比例尺。 */
  eyeDistanceCm: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  visibilityMin: 0.5,
  lostFramesThreshold: 3,
  medianWindow: 5,

  standingMaxHipDrop: 0.15,
  standingMaxTorsoAngle: 25,
  standingHoldMs: 300,
  descendHipDrop: 0.25,
  descendTorsoAngle: 40,
  descendHeadDrop: 0.25,
  proneHipDrop: 0.55,
  proneTorsoAngle: 60,
  proneHeadDrop: 0.5,
  proneRequiresCloseness: true,
  proneHoldMs: 200,
  riseHipDrop: 0.45,
  riseTorsoAngle: 50,
  riseHeadDropHysteresis: 0.15,
  minStateMs: 150,
  lostNoMotionMs: 3000,
  lostToPauseMs: 10000,
  motionEnergyFloor: 0.02,

  // 手机放地面时，安全距离（约 2.5m）下站姿高度仅占画面约 0.4，旧值 0.55 会逼人站进碰撞区
  targetHeightMin: 0.25,
  calibrationHoldMs: 2000,
  inFrameMargin: 0.05,
  closenessEyeScale: 1.4,
  noseOutBottomY: 0.98,

  collisionWarnY: 0.9,
  collisionBlockY: 0.95,
  eyeDistanceCm: 6.3,
};

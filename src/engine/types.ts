// 识别引擎的公共类型。引擎不依赖 DOM / MediaPipe，可纯单测。

/** BlazePose 归一化关键点（x,y ∈ [0,1]，y 向下；z 为相对深度）。 */
export interface Keypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** 一帧 33 个关键点；取不到人时为 null。 */
export type PoseFrame = Keypoint[] | null;

/** 一期用到的 BlazePose 关键点索引。 */
export const KP = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** 校准时记录的站姿基准。 */
export interface Baseline {
  /** 站姿人体像素高度 |nose.y − ankleMid.y|（帧高归一化）。 */
  H: number;
  hipY0: number;
  noseY0: number;
  /** 站姿眼部关键点间距（贴近特征"人脸变大"的参照）。 */
  eyeDist0: number;
}

export type FrameQuality = 'FULL' | 'PARTIAL' | 'LOST';

/** SignalExtractor 每帧输出。信号均相对校准基准归一化。 */
export interface FrameSignals {
  /** 帧时间戳 ms。 */
  t: number;
  quality: FrameQuality;
  valid: boolean;
  /** (hipMid.y − hipY0) / H，站立 ≈ 0，俯地趋近 1。 */
  hipDrop: number | null;
  /** 躯干与竖直方向夹角（度），站立 ≈ 0，俯卧 ≈ 90。 */
  torsoAngle: number | null;
  /** (nose.y − noseY0) / H，正面摆放下最可靠的强信号。 */
  headDrop: number | null;
  /** 表观身高 H_t / H，正面俯地时急剧缩小。 */
  apparentHeight: number | null;
  /** 眼部关键点（1–4）间距，归一化单位。 */
  eyeDistance: number | null;
  /** 躯干纵深 nose.z − hipMid.z。 */
  torsoDepth: number | null;
  /** 低成本运动能量（关键点帧差分），0..1。 */
  motionEnergy: number;
  /** 贴近特征：人脸变大或头部从画面底部出界。 */
  closeness: boolean;
  noseY: number | null;
  hipY: number | null;
  /** 手（腕/指尖）关键点最大 y，碰撞预判用。 */
  handMaxY: number | null;
}

/** 校准页"站姿全身入镜"分析的输出。 */
export interface StandingAnalysis {
  hasPerson: boolean;
  /** 当前帧人体高度（归一化）。 */
  height: number | null;
  noseY: number | null;
  ankleY: number | null;
  hipY: number | null;
  eyeDist: number | null;
  headOutTop: boolean;
  feetOutBottom: boolean;
}

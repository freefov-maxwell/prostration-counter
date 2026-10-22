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
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** 站姿基准（开始时自动采集，之后每次站直时微调）。 */
export interface Baseline {
  /** 站姿人体高度 |nose.y − ankleMid.y|（帧高归一化）。 */
  H: number;
  noseY0: number;
  /** 站姿肩宽（远近比的参照，人越近肩越宽）。 */
  shoulderW0: number;
  /** 站姿双耳间距（肩不可见时的远近比备用参照，0 表示未采到）。 */
  earW0: number;
}

export type FrameQuality = 'FULL' | 'PARTIAL' | 'LOST';

/** SignalExtractor 每帧输出。信号均相对站姿基准归一化。 */
export interface FrameSignals {
  /** 帧时间戳 ms。 */
  t: number;
  quality: FrameQuality;
  valid: boolean;
  /** (nose.y − noseY0) / H，站立 ≈ 0。 */
  headDrop: number | null;
  /** 远近比：肩宽 / 基准肩宽（无肩时用耳距），站立 ≈ 1，贴近镜头时 2–4。 */
  scale: number | null;
  /** 表观身高 / H，站立 ≈ 1。 */
  heightRatio: number | null;
  /** 躯干直立（肩在髋正上方）。 */
  upright: boolean;
  /** 严格站直：远近、高度、身高、直立、可见脚踝同时满足。 */
  standing: boolean;
  /** 低位程度：max(headDrop / 阈值, (scale − 1) / 阈值)，≥1 即低位。人丢失时保持上一有效值。 */
  lowness: number;
}

/** 起始站位分析的输出。 */
export interface StandingAnalysis {
  hasPerson: boolean;
  /** 当前帧人体高度（归一化）。 */
  height: number | null;
  noseY: number | null;
  ankleY: number | null;
  shoulderW: number | null;
  earW: number | null;
  upright: boolean;
  headOutTop: boolean;
  feetOutBottom: boolean;
}

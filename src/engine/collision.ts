// 试拜碰撞预判（技术文档 §5.1）。纯函数，输入试拜期间逐帧采样的手部/眼部/头部数据。
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';

export interface TrialSample {
  /** 手部关键点（腕/指尖）最大 y，null 表示该帧手不可见。 */
  handMaxY: number | null;
  /** 眼部关键点间距（归一化单位），建立 px/cm 比例尺用。 */
  eyeDistance: number | null;
  noseY: number | null;
}

export type CollisionVerdict = 'safe' | 'close' | 'tooClose' | 'wrongDirection';

export interface CollisionResult {
  verdict: CollisionVerdict;
  /** 试拜全程手部最低点的 max(y)。 */
  maxHandY: number | null;
  /** verdict === 'close' 时建议前挪的厘米数（±30% 精度可接受）。 */
  marginCm: number | null;
  headOutOfBottom: boolean;
}

/**
 * 画面底边即手机警戒线：关键点从底部出界 = 进入盲区。
 * max(y) ≤ 0.90 安全；(0.90, 0.95] 偏近，估算前挪距离；> 0.95 过近，必须前挪后重试。
 * 连头部都从底部出界说明手机摆在头的落点之后（摆错方向）。
 */
export function evaluateCollision(
  samples: TrialSample[],
  th: Thresholds = DEFAULT_THRESHOLDS,
): CollisionResult {
  let maxHandY: number | null = null;
  let eyeAtMax: number | null = null;
  let headOutOfBottom = false;

  for (const s of samples) {
    if (s.noseY != null && s.noseY > th.noseOutBottomY) headOutOfBottom = true;
    if (s.handMaxY != null && (maxHandY == null || s.handMaxY > maxHandY)) {
      maxHandY = s.handMaxY;
      eyeAtMax = s.eyeDistance;
    }
  }

  if (headOutOfBottom) {
    return { verdict: 'wrongDirection', maxHandY, marginCm: null, headOutOfBottom };
  }
  if (maxHandY == null) {
    // 试拜全程没看清手：无法排除风险，按过近处理要求重试
    return { verdict: 'tooClose', maxHandY, marginCm: null, headOutOfBottom };
  }
  if (maxHandY > th.collisionBlockY) {
    return { verdict: 'tooClose', maxHandY, marginCm: null, headOutOfBottom };
  }
  if (maxHandY > th.collisionWarnY) {
    // 指尖到画面底边的像素余量 → 厘米（双眼间距 6.3cm 建立比例尺）
    let marginCm: number | null = null;
    if (eyeAtMax != null && eyeAtMax > 0) {
      const cmPerUnit = th.eyeDistanceCm / eyeAtMax;
      marginCm = Math.max(5, Math.round(((1 - maxHandY) * cmPerUnit) / 5) * 5);
    }
    return { verdict: 'close', maxHandY, marginCm, headOutOfBottom };
  }
  return { verdict: 'safe', maxHandY, marginCm: null, headOutOfBottom };
}

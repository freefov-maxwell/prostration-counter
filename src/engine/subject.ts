// 多人入镜时从候选里挑出本人（MediaPipe 多人识别用；MoveNet 只出一个人，不经过这里）。
// 两个依据：帧间连续（本人上一帧在哪，这一帧就在附近）；侧向位置 u = 两肩中点离画面中心几个肩宽——
// 人沿镜头方向扑近时离中心的距离与肩宽同比放大，u 不变，旁人只要不在正前 / 正后方就差得远。
import { DEFAULT_THRESHOLDS, Thresholds } from './thresholds';
import { KP, Keypoint, PoseFrame } from './types';

interface Box {
  cx: number;
  cy: number;
  area: number;
}

function box(frame: Keypoint[], th: Thresholds): Box | null {
  const pts = frame.filter((k) => k.visibility >= th.visibilityMin);
  if (!pts.length) return null;
  const xs = pts.map((k) => k.x);
  const ys = pts.map((k) => k.y);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, area: (x2 - x1) * (y2 - y1) };
}

/** 侧向位置；肩不可见或肩宽过窄（侧身、误检）判不出时为 null。 */
export function lateral(frame: Keypoint[], th: Thresholds = DEFAULT_THRESHOLDS): number | null {
  const l = frame[KP.leftShoulder];
  const r = frame[KP.rightShoulder];
  if (!l || !r || l.visibility < th.visibilityMin || r.visibility < th.visibilityMin) return null;
  const dx = Math.abs(l.x - r.x);
  return dx < 0.02 ? null : ((l.x + r.x) / 2 - 0.5) / dx;
}

export class SubjectTracker {
  private last: { box: Box; t: number } | null = null;
  private u0: number | null = null;
  private recentU: number[] = [];

  constructor(private th: Thresholds = DEFAULT_THRESHOLDS) {}

  /** 选出本人；没有合格候选返回 null（引擎按人丢失处理）。 */
  pick(poses: Keypoint[][], t: number): PoseFrame {
    const th = this.th;
    const cands = poses
      .map((frame) => ({ frame, box: box(frame, th), u: lateral(frame, th) }))
      .filter((c): c is typeof c & { box: Box } => !!c.box)
      .filter((c) => this.u0 == null || c.u == null || Math.abs(c.u - this.u0) <= th.subjectMaxOffset);
    if (!cands.length) return null;
    const last = this.last;
    const u0 = this.u0;
    const cost =
      last && t - last.t <= th.subjectTrackMs
        ? (c: (typeof cands)[0]) => Math.hypot(c.box.cx - last.box.cx, c.box.cy - last.box.cy)
        : u0 != null
          ? (c: (typeof cands)[0]) => (c.u == null ? Infinity : Math.abs(c.u - u0))
          : (c: (typeof cands)[0]) => -c.box.area; // 未锁定（站位阶段）：离镜头最近、站在框里的那个
    const best = cands.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    this.last = { box: best.box, t };
    if (best.u != null) {
      this.recentU.push(best.u);
      if (this.recentU.length > th.medianWindow) this.recentU.shift();
    }
    return best.frame;
  }

  /** 本人稳稳站着时调用：以最近几帧的中值锁定侧向位置。 */
  anchor(): void {
    if (!this.recentU.length) return;
    const s = [...this.recentU].sort((a, b) => a - b);
    this.u0 = s[Math.floor(s.length / 2)];
  }

  /** 暂停时解锁：本人横移过远被挡掉时不至于卡死，站好后重新锁定。 */
  release(): void {
    this.u0 = null;
  }
}

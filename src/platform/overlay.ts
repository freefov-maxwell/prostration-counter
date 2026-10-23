// 骨架叠加层：canvas 与 video 同尺寸、同 object-fit/镜像样式，坐标直接用归一化关键点，无需换算裁切。
import { DrawingUtils, PoseLandmarker } from '@mediapipe/tasks-vision';
import { PoseFrame } from '../engine/types';

/**
 * guideOk 非 null 时画入镜参考框：上下边线即"头/脚不能越过"的判定线，绿 = 合格，红 = 不合格。
 * 参考框只画在屏幕实际可见的裁切区域内。
 */
export function drawPose(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: PoseFrame,
  guideOk: boolean | null,
  margin: number,
): void {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  if (guideOk != null) {
    const elRatio = canvas.clientWidth / canvas.clientHeight || w / h;
    const visW = Math.min(1, elRatio / (w / h));
    const visH = Math.min(1, w / h / elRatio);
    const x0 = ((1 - visW) / 2 + 0.06) * w;
    const x1 = w - x0;
    const y0 = Math.max(margin, (1 - visH) / 2 + 0.01) * h;
    const y1 = h - y0;
    ctx.strokeStyle = guideOk ? '#43c45a' : '#e5484d';
    ctx.lineWidth = Math.max(4, w / 120);
    ctx.setLineDash([w / 30, w / 50]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  }

  if (frame) {
    const du = new DrawingUtils(ctx);
    const lw = Math.max(3, w / 180);
    // visibility 为 0 的是模型没有的点（MoveNet 只有 17 点），不画
    const conns = PoseLandmarker.POSE_CONNECTIONS.filter((c) => frame[c.start].visibility > 0 && frame[c.end].visibility > 0);
    du.drawConnectors(frame, conns, { color: '#7fe3ff', lineWidth: lw });
    du.drawLandmarks(frame.filter((k) => k.visibility > 0), { color: '#ffffff', fillColor: '#ffffff', radius: lw, lineWidth: 1 });
  }
}

export function downloadJson(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// MediaPipe PoseLandmarker 适配层（识别引擎的 PoseAdapter 一期唯一实现）。
// v1 决策：推理跑主线程 + 背压丢帧（见 README），WASM 全部本地自托管。
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { PoseFrame } from '../engine/types';

let landmarker: PoseLandmarker | null = null;
let loading: Promise<PoseLandmarker> | null = null;

/** 模型懒加载：首次进入校准页才加载，之后走 Service Worker 缓存。 */
export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (landmarker) return Promise.resolve(landmarker);
  if (loading) return loading;
  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    return landmarker;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** 送推理的帧不镜像，与镜像显示解耦；上一帧未完成则丢弃新帧（背压）。 */
export class PoseDetector {
  private busy = false;
  private lastVideoTime = -1;

  constructor(private lm: PoseLandmarker) {}

  /** 返回 null 表示本帧被跳过（忙或画面未更新）。 */
  detect(video: HTMLVideoElement, nowMs: number): PoseFrame | null | 'skip' {
    if (this.busy) return 'skip';
    if (video.currentTime === this.lastVideoTime) return 'skip';
    if (video.readyState < 2) return 'skip';
    this.lastVideoTime = video.currentTime;
    this.busy = true;
    try {
      const result = this.lm.detectForVideo(video, nowMs);
      const lms = result.landmarks?.[0];
      if (!lms) return null;
      return lms.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 0,
      }));
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }
}

export function disposePoseLandmarker() {
  landmarker?.close();
  landmarker = null;
  loading = null;
}

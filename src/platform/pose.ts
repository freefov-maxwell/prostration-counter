// MediaPipe PoseLandmarker 适配层（识别引擎的 PoseAdapter 一期唯一实现）。
// v1 决策：推理跑主线程 + 背压丢帧（见 README），WASM 全部本地自托管。
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { PoseFrame } from '../engine/types';

let landmarker: PoseLandmarker | null = null;
let loading: Promise<PoseLandmarker> | null = null;

export interface LoadProgress {
  /** 阶段名：「识别引擎」或「姿态模型」 */
  label: string;
  /** 本阶段已下载字节 */
  loaded: number;
  /** 本阶段总字节（0 表示服务器未返回 Content-Length） */
  total: number;
}

/** 流式下载并逐块回报进度，返回完整字节。 */
async function downloadWithProgress(
  url: string,
  onBytes: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载失败（${resp.status}）：${url}`);
  const total = Number(resp.headers.get('Content-Length') ?? 0);
  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    onBytes(buf.byteLength, total || buf.byteLength);
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * 模型懒加载：首次进入校准页才加载，之后走 Service Worker 运行时缓存（CacheFirst）离线可用。
 * 推理引擎（WASM，约 11MB）先自行预热下载以回报进度，FilesetResolver 随后命中缓存；
 * 姿态模型下载后转 Blob URL 直接装载，不二次请求。
 */
export function loadPoseLandmarker(
  onProgress?: (p: LoadProgress) => void,
): Promise<PoseLandmarker> {
  if (landmarker) return Promise.resolve(landmarker);
  if (loading) return loading;
  const base = import.meta.env.BASE_URL;
  loading = (async () => {
    await downloadWithProgress(`${base}wasm/vision_wasm_internal.js`, () => {});
    await downloadWithProgress(`${base}wasm/vision_wasm_internal.wasm`, (loaded, total) =>
      onProgress?.({ label: '识别引擎', loaded, total }),
    );
    const modelBytes = await downloadWithProgress(
      `${base}models/pose_landmarker_lite.task`,
      (loaded, total) => onProgress?.({ label: '姿态模型', loaded, total }),
    );
    const vision = await FilesetResolver.forVisionTasks(`${base}wasm`);
    const modelUrl = URL.createObjectURL(new Blob([modelBytes as BlobPart]));
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    } finally {
      URL.revokeObjectURL(modelUrl);
    }
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

// MediaPipe PoseLandmarker 适配层（识别引擎的 PoseAdapter 一期唯一实现）。
// v1 决策：推理跑主线程 + 背压丢帧（见 README），WASM 全部本地自托管。
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { PoseFrame } from '../engine/types';

let landmarker: PoseLandmarker | null = null;
let loading: Promise<PoseLandmarker> | null = null;

export interface LoadProgress {
  /** 全部资源累计已下载字节（解压后口径） */
  loaded: number;
  /** 全部资源总字节（0 表示大小未知，进度条走不定态） */
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
 * 模型懒加载：首次进入运动页才加载，之后走 Service Worker 运行时缓存（CacheFirst）离线可用。
 * 引擎（JS + WASM）与姿态模型并行下载，进度合并为一条总进度；
 * 总量以 public/pose-assets.json（构建期生成的解压后大小清单）为准——服务器开 gzip/brotli 时
 * Content-Length 是压缩后大小，与流式读到的解压后字节不一致，不能作为进度口径。
 * 预热下载后 FilesetResolver 命中缓存；模型字节转 Blob URL 直接装载，不二次请求。
 */
export function loadPoseLandmarker(
  onProgress?: (p: LoadProgress) => void,
): Promise<PoseLandmarker> {
  if (landmarker) return Promise.resolve(landmarker);
  if (loading) return loading;
  const base = import.meta.env.BASE_URL;
  const files = [
    'wasm/vision_wasm_internal.js',
    'wasm/vision_wasm_internal.wasm',
    'models/pose_landmarker_lite.task',
  ];
  loading = (async () => {
    let total = 0;
    try {
      const resp = await fetch(`${base}pose-assets.json`);
      if (resp.ok) {
        const sizes: Record<string, number> = await resp.json();
        total = files.reduce((sum, f) => sum + (sizes[f] ?? 0), 0);
      }
    } catch {
      // 清单不可用时退化为不定态进度（total = 0）
    }
    const currents = files.map(() => 0);
    const report = () =>
      onProgress?.({ loaded: currents.reduce((a, b) => a + b, 0), total });
    const [, , modelBytes] = await Promise.all(
      files.map((f, i) =>
        downloadWithProgress(`${base}${f}`, (loaded) => {
          currents[i] = loaded;
          report();
        }),
      ),
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

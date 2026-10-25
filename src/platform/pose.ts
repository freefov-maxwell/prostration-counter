// MediaPipe PoseLandmarker 适配层：设置里可切换的高精度引擎（默认引擎为 MoveNet，见 movenet.ts）。
// v1 决策：推理跑主线程 + 背压丢帧（见 README），WASM 全部本地自托管。
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Keypoint } from '../engine/types';

let landmarker: PoseLandmarker | null = null;
let loading: Promise<PoseLandmarker> | null = null;

export interface LoadProgress {
  /** 全部资源累计已下载字节（gzip 压缩后口径，与界面提示的下载大小一致） */
  loaded: number;
  /** 全部资源压缩后总字节（0 表示大小未知，进度条走不定态） */
  total: number;
}

/** 流式下载并逐块回报进度，返回完整字节。 */
export async function downloadWithProgress(
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

type AssetSizes = Record<string, { raw: number; gz: number }>;

async function assetSizes(): Promise<AssetSizes> {
  try {
    const resp = await fetch(`${import.meta.env.BASE_URL}pose-assets.json`);
    return resp.ok ? await resp.json() : {};
  } catch {
    return {};
  }
}

/**
 * 并行下载若干资源，进度合并为一条总进度。
 * fetch 流读到的是解压后字节，按 pose-assets.json 里各文件的压缩率折算成压缩后口径；
 * 清单缺任一文件则总量记 0（进度条走不定态）。
 */
export async function downloadAssets(
  files: string[],
  onProgress?: (p: LoadProgress) => void,
): Promise<Uint8Array[]> {
  const sizes = await assetSizes();
  const base = import.meta.env.BASE_URL;
  // 校验 gz 字段：旧格式清单（值为数字）可能仍在缓存里
  const known = files.every((f) => sizes[f]?.gz > 0 && sizes[f]?.raw > 0);
  const ratio = files.map((f) => (known ? sizes[f].gz / sizes[f].raw : 1));
  const total = known ? files.reduce((sum, f) => sum + sizes[f].gz, 0) : 0;
  const currents = files.map(() => 0);
  return Promise.all(
    files.map((f, i) =>
      downloadWithProgress(`${base}${f}`, (loaded) => {
        currents[i] = loaded * ratio[i];
        onProgress?.({ loaded: currents.reduce((a, b) => a + b, 0), total });
      }),
    ),
  );
}

/**
 * 模型懒加载：首次进入运动页才加载，之后走 Service Worker 运行时缓存（CacheFirst）离线可用。
 * 引擎（JS + WASM）与姿态模型并行下载（downloadAssets），进度合并为一条总进度；
 * 总量以 public/pose-assets.json（构建期生成的大小清单）为准——服务器开 gzip/brotli 时
 * Content-Length 是压缩后大小，而流式读到的是解压后字节，不能直接作为进度口径。
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
    const [, , modelBytes] = await downloadAssets(files, onProgress);
    const vision = await FilesetResolver.forVisionTasks(`${base}wasm`);
    const modelUrl = URL.createObjectURL(new Blob([modelBytes as BlobPart]));
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO',
        // 本人 + 最多 2 个旁人，由 SubjectTracker 挑出本人；耗时随画面里实际人数增长
        numPoses: 3,
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

  /** 返回画面中全部人的关键点（没人为 []）；'skip' 表示本帧被跳过（忙或画面未更新）。 */
  detect(video: HTMLVideoElement, nowMs: number): Keypoint[][] | 'skip' {
    if (this.busy) return 'skip';
    if (video.currentTime === this.lastVideoTime) return 'skip';
    if (video.readyState < 2) return 'skip';
    this.lastVideoTime = video.currentTime;
    this.busy = true;
    try {
      const result = this.lm.detectForVideo(video, nowMs);
      return (result.landmarks ?? []).map((lms) =>
        lms.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          visibility: p.visibility ?? 0,
        })),
      );
    } catch {
      return [];
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

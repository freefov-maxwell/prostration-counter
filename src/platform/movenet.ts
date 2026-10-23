// MoveNet SinglePose Lightning（TF.js）适配层：默认的轻量引擎（约 6MB，MediaPipe 约 17MB，设置里可切换）。
// 输出补成 BlazePose 33 点布局，识别引擎无需改动；MoveNet 没有的点 visibility 为 0，z 恒为 0。
// 本模块经动态 import 按需加载，切到 MediaPipe 的用户不下载 TF.js。
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import { GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import { Keypoint, PoseFrame } from '../engine/types';
import { assetsTotal, downloadWithProgress, LoadProgress } from './pose';

const SIZE = 192;
const FILES = ['models/movenet/model.json', 'models/movenet/group1-shard1of2.bin', 'models/movenet/group1-shard2of2.bin'];
/** COCO 17 点（MoveNet 输出顺序）→ BlazePose 33 点索引。 */
const COCO_TO_BLAZE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
/**
 * 各点 MoveNet 得分达到此值即视同 BlazePose visibility 0.5（引擎的 visibilityMin），按 COCO 顺序。
 * 真机录制标定：头部（鼻、眼、耳）与脚踝得分 0.24–0.3 时位置偏差仍 < 3% 身高，可放宽；
 * 肩、髋低置信时偏差达 3–9%（肩宽决定远近比），维持官方 demo 常用的 0.3。
 */
const SCORE_AT_VIS_MIN = [0.24, 0.24, 0.24, 0.24, 0.24, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.24, 0.24];
/** 低于此置信的点不参与下一帧裁剪框估计；全部低于则视为无人。 */
const MIN_SCORE = 0.2;

/** 裁剪框 [y1, x1, y2, x2]，按帧高/帧宽归一化，可超出 [0,1]（超出部分补黑）。 */
type Box = [number, number, number, number];
interface Raw {
  x: number;
  y: number;
  score: number;
}

/** 整帧补成正方形，保持人体比例。 */
export function fullBox(w: number, h: number): Box {
  if (w > h) {
    const d = (w - h) / 2 / h;
    return [-d, 0, 1 + d, 1];
  }
  const d = (h - w) / 2 / w;
  return [0, -d, 1, 1 + d];
}

/** 参照 tfjs-models MoveNet 的裁剪策略：以上一帧躯干为中心取正方形，人越大框越大；躯干不可靠则回整帧。 */
export function nextBox(kp: Raw[], w: number, h: number): Box | null {
  const p = kp.map((k) => ({ x: k.x * w, y: k.y * h, ok: k.score > MIN_SCORE }));
  const mid = (a: number, b: number) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 });
  const c = p[11].ok && p[12].ok ? mid(11, 12) : p[5].ok && p[6].ok ? mid(5, 6) : null;
  if (!c) return null;
  let torso = 0;
  let body = 0;
  p.forEach((k, i) => {
    if (!k.ok) return;
    const r = Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y));
    body = Math.max(body, r);
    if (i === 5 || i === 6 || i === 11 || i === 12) torso = Math.max(torso, r);
  });
  const half = Math.min(Math.max(torso * 1.9, body * 1.2), Math.max(c.x, w - c.x, c.y, h - c.y));
  if (half > Math.max(w, h) / 2) return null;
  return [(c.y - half) / h, (c.x - half) / w, (c.y + half) / h, (c.x + half) / w];
}

let model: GraphModel | null = null;
let loading: Promise<GraphModel> | null = null;

export function loadMoveNet(onProgress?: (p: LoadProgress) => void): Promise<GraphModel> {
  if (model) return Promise.resolve(model);
  if (loading) return loading;
  loading = (async () => {
    const base = import.meta.env.BASE_URL;
    const total = await assetsTotal(FILES);
    await tf.setBackend('webgl');
    await tf.ready();
    // 自己流式下载以按字节报进度：loadGraphModel 的 onProgress 只在响应头到达、整个分片下完时跳变
    const currents = FILES.map(() => 0);
    const [json, ...shards] = await Promise.all(
      FILES.map((f, i) =>
        downloadWithProgress(`${base}${f}`, (loaded) => {
          currents[i] = loaded;
          onProgress?.({ loaded: currents.reduce((a, b) => a + b, 0), total });
        }),
      ),
    );
    // FILES 里分片顺序与 model.json 的 weightsManifest.paths 一致
    const artifacts = await tf.io.getModelArtifactsForJSON(JSON.parse(new TextDecoder().decode(json)), async (manifest) => [
      manifest.flatMap((g) => g.weights),
      shards.map((b) => b.buffer as ArrayBuffer),
    ]);
    const m = await loadGraphModel(tf.io.fromMemory(artifacts));
    // 预热：首次推理编译着色器较慢，放在加载阶段而不是第一帧
    tf.tidy(() => {
      m.execute(tf.zeros([1, SIZE, SIZE, 3], 'int32'));
    });
    model = m;
    return m;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** 与 PoseDetector 同契约：'skip' 表示本帧跳过，null 表示没人。 */
export class MoveNetDetector {
  private lastVideoTime = -1;
  private box: Box | null = null;

  constructor(private m: GraphModel) {}

  detect(video: HTMLVideoElement): PoseFrame | 'skip' {
    if (video.currentTime === this.lastVideoTime) return 'skip';
    if (video.readyState < 2) return 'skip';
    this.lastVideoTime = video.currentTime;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const box = this.box ?? fullBox(w, h);
    try {
      // shortcut: dataSync 同步读回 GPU 结果会阻塞主线程几毫秒，掉帧明显时改 await data() + 背压
      const out = tf.tidy(() => {
        const img = tf.expandDims<tf.Tensor4D>(tf.cast(tf.browser.fromPixels(video), 'float32'));
        const input = tf.cast(tf.image.cropAndResize(img, [box], [0], [SIZE, SIZE]), 'int32');
        return (this.m.execute(input) as tf.Tensor).dataSync();
      });
      const kp: Raw[] = COCO_TO_BLAZE.map((_, i) => ({
        y: box[0] + out[i * 3] * (box[2] - box[0]),
        x: box[1] + out[i * 3 + 1] * (box[3] - box[1]),
        score: out[i * 3 + 2],
      }));
      this.box = nextBox(kp, w, h);
      if (kp.every((k) => k.score < MIN_SCORE)) return null;
      const frame: Keypoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
      kp.forEach((k, i) => {
        frame[COCO_TO_BLAZE[i]] = { x: k.x, y: k.y, z: 0, visibility: Math.min(1, (k.score * 0.5) / SCORE_AT_VIS_MIN[i]) };
      });
      return frame;
    } catch {
      this.box = null;
      return null;
    }
  }
}

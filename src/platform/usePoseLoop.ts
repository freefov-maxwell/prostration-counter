// 取帧 + 推理循环 Hook（技术文档 §3.2）。
// rAF 驱动，限速约 15fps（识别引擎按 15fps 设计，更高只多耗电发热）；上一帧未完成则丢弃新帧（背压）；
// 组件卸载时停止相机与循环。
import { useEffect, useRef, useState } from 'react';
import { PoseFrame } from '../engine/types';
import type { PoseModel } from '../db/db';
import { startCamera, stopCamera, cameraErrorMessage } from './camera';
import { loadPoseLandmarker, LoadProgress, PoseDetector } from './pose';

/** 推理间隔：15fps，留 8ms 余量让 60/120Hz 屏的 rAF 恰好每 4 / 8 帧触发一次。 */
const DETECT_INTERVAL_MS = 1000 / 15 - 8;

interface Options {
  /** inferMs：本帧推理耗时，供调试导出评估机型性能。 */
  onFrame: (frame: PoseFrame, t: number, inferMs: number) => void;
  onError: (message: string) => void;
  onProgress?: (p: LoadProgress) => void;
  model?: PoseModel;
}

async function loadDetector(model: PoseModel | undefined, onProgress?: (p: LoadProgress) => void) {
  if (model === 'movenet') {
    const { loadMoveNet, MoveNetDetector } = await import('./movenet');
    return new MoveNetDetector(await loadMoveNet(onProgress));
  }
  return new PoseDetector(await loadPoseLandmarker(onProgress));
}

export function usePoseLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  opts: Options,
  retryKey = 0,
) {
  const [stage, setStage] = useState<'loading' | 'ready' | 'error'>('loading');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        const [detector] = await Promise.all([
          loadDetector(optsRef.current.model, optsRef.current.onProgress),
          (async () => {
            if (!videoRef.current) throw new Error('no video element');
            stream = await startCamera(videoRef.current);
          })(),
        ]);
        if (cancelled) return;
        setStage('ready');
        let lastDetect = -Infinity;
        const loop = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const t0 = performance.now();
          if (video && t0 - lastDetect >= DETECT_INTERVAL_MS) {
            const frame = detector.detect(video, t0);
            if (frame !== 'skip') {
              lastDetect = t0;
              const t1 = performance.now();
              optsRef.current.onFrame(frame, t1, t1 - t0);
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (!cancelled) {
          setStage('error');
          optsRef.current.onError(cameraErrorMessage(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopCamera(stream, videoRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  return stage;
}

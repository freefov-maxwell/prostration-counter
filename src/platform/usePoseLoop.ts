// 取帧 + 推理循环 Hook（技术文档 §3.2）。
// rAF 驱动；上一帧未完成则丢弃新帧（背压）；组件卸载时停止相机与循环。
import { useEffect, useRef, useState } from 'react';
import { PoseFrame } from '../engine/types';
import { startCamera, stopCamera, cameraErrorMessage } from './camera';
import { loadPoseLandmarker, PoseDetector } from './pose';

interface Options {
  onFrame: (frame: PoseFrame, t: number) => void;
  onError: (message: string) => void;
}

export function usePoseLoop(videoRef: React.RefObject<HTMLVideoElement | null>, opts: Options) {
  const [stage, setStage] = useState<'loading' | 'ready' | 'error'>('loading');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        const [lm] = await Promise.all([
          loadPoseLandmarker(),
          (async () => {
            if (!videoRef.current) throw new Error('no video element');
            stream = await startCamera(videoRef.current);
          })(),
        ]);
        if (cancelled) return;
        const detector = new PoseDetector(lm);
        setStage('ready');
        const loop = () => {
          if (cancelled) return;
          const video = videoRef.current;
          if (video) {
            const frame = detector.detect(video, performance.now());
            if (frame !== 'skip') optsRef.current.onFrame(frame, performance.now());
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
  }, []);

  return stage;
}

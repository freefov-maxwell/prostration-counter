// 相机适配层（技术文档 §3.1）。
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null, video?: HTMLVideoElement | null) {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

export function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return '摄像头权限被拒绝，请在浏览器设置中允许后重试';
    if (err.name === 'NotFoundError') return '未检测到摄像头设备';
    if (err.name === 'NotReadableError') return '摄像头被其他应用占用，请关闭后重试';
  }
  return '摄像头启动失败，请检查设备后重试';
}

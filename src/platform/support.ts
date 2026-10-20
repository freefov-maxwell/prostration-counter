// 环境能力检测：无 getUserMedia 或 WebGL2 → 不支持页，不白屏。
export interface SupportResult {
  ok: boolean;
  reasons: string[];
}

export function checkSupport(): SupportResult {
  const reasons: string[] = [];
  if (!navigator.mediaDevices?.getUserMedia) {
    reasons.push('当前环境不支持摄像头访问（需要 HTTPS 或 localhost）');
  }
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('webgl2')) {
    reasons.push('当前浏览器不支持 WebGL2，无法运行姿态识别');
  }
  return { ok: reasons.length === 0, reasons };
}
